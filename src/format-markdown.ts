import { fromMarkdown } from 'mdast-util-from-markdown';
import * as markdownPlugin from 'prettier/plugins/markdown';
import * as prettier from 'prettier/standalone';

export interface MarkdownOptions {
  tabWidth: number;
  useTabs: boolean;
}

interface MarkdownNode {
  type: string;
  ordered?: boolean;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start: { line: number; offset: number };
    end: { line: number; offset: number };
  };
}

// Markdown uses four-column tab stops, independently of the editor's display width.
const columns = (prefix: string): number => {
  let width = 0;
  for (const character of prefix) {
    width += character === '\t' ? 4 - (width % 4) : 1;
  }
  return width;
};

const getPrefix = (line: string): string => /^[\t ]*/u.exec(line)?.[0] ?? '';
const removeColumns = (prefix: string, count: number): string => {
  let width = 0;
  let index = 0;
  while (index < prefix.length && width < count) {
    width += prefix[index] === '\t' ? 4 - (width % 4) : 1;
    index++;
  }
  return ' '.repeat(Math.max(0, width - count)) + prefix.slice(index);
};
const makePrefix = (width: number, tabs: boolean): string => {
  const tabCount = tabs ? Math.floor(width / 4) : 0;
  return '\t'.repeat(tabCount) + ' '.repeat(width - tabCount * 4);
};
// The standalone Markdown parser does not consume formatter options.
const parseMarkdown = markdownPlugin.parsers.markdown.parse as (
  text: string,
) => MarkdownNode | Promise<MarkdownNode>;

const codeSignature = (node: MarkdownNode): string =>
  JSON.stringify([
    node.position?.start.line,
    node.position?.end.line,
    node.value,
  ]);

const findClosingFence = (
  lines: string[],
  openerLine: number,
  openerOffset: number,
  delimiter: string,
  contentIndent: number,
): { line: number; offset: number } | undefined => {
  const closerPattern = new RegExp(
    `^([\\t ]*)${delimiter[0]}{${delimiter.length},}[\\t ]*$`,
    'u',
  );
  let offset = openerOffset + lines[openerLine].length + 1;
  for (let line = openerLine + 1; line < lines.length; line++) {
    const text = lines[line].replace(/\r$/u, '');
    const closer = closerPattern.exec(text);
    const closerIndent = closer ? columns(closer[1]) : -1;
    if (
      closer &&
      closerIndent >= contentIndent &&
      closerIndent <= contentIndent + 3
    )
      return {
        line,
        offset: offset + text.length + (lines[line].endsWith('\r') ? 1 : 0),
      };
    if (text.trim() && columns(getPrefix(text)) < contentIndent)
      return { line: line - 1, offset: offset - 1 };
    offset += lines[line].length + 1;
  }
  const trailingNewline = lines.at(-1) === '';
  return {
    line: Math.max(openerLine, lines.length - (trailingNewline ? 2 : 1)),
    offset: offset - 1 - (trailingNewline ? 1 : 0),
  };
};

const shiftWhitespaceLines = (
  lines: string[],
  start: number,
  end: number,
  shift: number,
) => {
  for (let line = start; line < end; line++) {
    if (lines[line] && !lines[line].trim()) {
      const prefix = getPrefix(lines[line]);
      const carriageReturn = lines[line].endsWith('\r') ? '\r' : '';
      lines[line] =
        shift < 0
          ? removeColumns(prefix, -shift) + carriageReturn
          : makePrefix(shift, false) + prefix + carriageReturn;
    }
  }
};

const fencedListItems = (
  text: string,
): NonNullable<MarkdownNode['position']>[] => {
  const parsedFenceRanges: NonNullable<MarkdownNode['position']>[] = [];
  const visit = (node: MarkdownNode) => {
    if (
      node.type === 'code' &&
      node.position &&
      /^[\t ]{0,3}(?:`{3,}|~{3,})/u.test(
        text.slice(node.position.start.offset, node.position.end.offset),
      )
    ) {
      parsedFenceRanges.push(node.position);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text) as MarkdownNode);

  const ranges: NonNullable<MarkdownNode['position']>[] = [];
  const lines = text.split('\n');
  let lineOffset = 0;
  for (let index = 0; index < lines.length; index++) {
    let consumedThroughClosingLine = false;
    const line = lines[index].replace(/\r$/u, '');
    const opener =
      /^([\t ]*(?:[-+*]|\d+[.)])[\t ]+)(`{3,}|~{3,})[^\r\n]*$/u.exec(line);
    const invalidBacktickInfo =
      opener?.[2][0] === '`' &&
      line.slice(opener[1].length + opener[2].length).includes('`');
    if (opener && !invalidBacktickInfo) {
      const startOffset = lineOffset + opener[1].length;
      // A list-looking line inside an already parsed standalone fence is code,
      // not a structural list item.
      const insideParsedFence = parsedFenceRanges.some(
        ({ start, end }) =>
          start.offset < startOffset && startOffset < end.offset,
      );
      if (!insideParsedFence) {
        const delimiter = opener[2];
        const closing = findClosingFence(
          lines,
          index,
          lineOffset,
          delimiter,
          columns(opener[1]),
        );
        if (closing) {
          ranges.push({
            end: { line: closing.line + 1, offset: closing.offset },
            start: { line: index + 1, offset: startOffset },
          });
          index = closing.line;
          lineOffset = closing.offset + 1;
          consumedThroughClosingLine = true;
        }
      }
    }
    if (!consumedThroughClosingLine) lineOffset += lines[index].length + 1;
  }
  return ranges;
};

// Prettier's Markdown parser can read valid indented code in ordered lists as
// prose. Preserve the containing block before either indentation normalization
// or Prettier can remove the columns that make it code.
const unsafeCodeBlocks = async (
  text: string,
): Promise<NonNullable<MarkdownNode['position']>[]> => {
  const recognized = new Set<string>();
  const collect = (node: MarkdownNode) => {
    if (node.type === 'code') recognized.add(codeSignature(node));
    for (const child of node.children ?? []) collect(child);
  };
  const prettierTree = await parseMarkdown(text);
  collect(prettierTree);
  const hasUnsafeCode = (node: MarkdownNode, ordered = false): boolean => {
    const insideOrdered = ordered || (node.type === 'list' && !!node.ordered);
    // Normalizing a list's outer indentation can also make recognized code
    // ambiguous to Prettier. Protect indented ordered-list code beforehand.
    const indentedOrderedCode =
      insideOrdered &&
      node.position &&
      columns(getPrefix(text.slice(node.position.start.offset))) >= 4;
    return (
      (node.type === 'code' &&
        (indentedOrderedCode || !recognized.has(codeSignature(node)))) ||
      (node.children ?? []).some((child) => hasUnsafeCode(child, insideOrdered))
    );
  };
  const commonmarkBlocks = fromMarkdown(text).children as MarkdownNode[];
  const blocks = [...commonmarkBlocks, ...(prettierTree.children ?? [])];
  const ranges = commonmarkBlocks.flatMap((node, index) => {
    if (!node.position || !hasUnsafeCode(node)) return [];
    const previous = commonmarkBlocks[index - 1];
    // Renumbering a preceding list can shorten its continuation indentation
    // enough to absorb a standalone indented code block as list content.
    const start =
      node.type === 'code' && previous?.type === 'list'
        ? previous.position?.start
        : undefined;
    return [{ ...node.position, start: start ?? node.position.start }];
  });
  // A parser disagreement can cross block boundaries: code that CommonMark
  // places between lists may be part of one list to Prettier. Preserve that
  // entire source context so formatting its neighbor cannot absorb the code.
  for (const range of ranges) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const { position } of blocks) {
        if (
          position &&
          position.start.offset < range.end.offset &&
          range.start.offset < position.end.offset
        ) {
          if (position.start.offset < range.start.offset) {
            range.start = position.start;
            expanded = true;
          }
          if (position.end.offset > range.end.offset) {
            range.end = position.end;
            expanded = true;
          }
        }
      }
    }
  }
  ranges.sort((left, right) => left.start.offset - right.start.offset);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start.offset <= previous.end.offset) {
      if (range.end.offset > previous.end.offset) previous.end = range.end;
    } else merged.push(range);
  }
  return merged;
};

interface Fence {
  character: string;
  length: number;
}
const nextFence = (
  fence: Fence | undefined,
  delimiter: RegExpExecArray | null,
): Fence | undefined => {
  if (!delimiter) return fence;
  if (!fence)
    return { character: delimiter[1][0], length: delimiter[1].length };
  return delimiter[1][0] === fence.character &&
    delimiter[1].length >= fence.length &&
    !delimiter[2].trim()
    ? undefined
    : fence;
};
interface IndentItem {
  original: number;
  normalized: number;
  markerWidth: number;
}
const targetIndent = (
  stack: IndentItem[],
  indent: number,
  marker: string | undefined,
  unit: number,
  nonempty: boolean,
): number => {
  if (marker !== undefined) {
    while (indent <= (stack.at(-1)?.original ?? -1)) stack.pop();
    const parent = stack.at(-1);
    const target = parent
      ? parent.normalized +
        Math.max(unit, Math.ceil(parent.markerWidth / unit) * unit)
      : 0;
    stack.push({
      markerWidth: columns(marker),
      normalized: target,
      original: indent,
    });
    return target;
  }
  while (stack.length > 1 && nonempty && indent < (stack.at(-1)?.original ?? 0))
    stack.pop();
  const owner = stack.at(-1);
  return owner && indent >= owner.original
    ? indent + owner.normalized - owner.original
    : indent;
};

const normalizeLists = async (
  text: string,
  unit: number,
  tabs: boolean,
): Promise<string> => {
  const tree = await parseMarkdown(text);
  const lines = text.split('\n');
  const fencedItemLines = new Set(
    fencedListItems(text).map(({ start }) => start.line - 1),
  );
  const lists: MarkdownNode[] = [];
  const protectedLines = new Set<number>();
  const itemLines = new Set<number>();
  const visit = (node: MarkdownNode, insideList = false) => {
    if (node.type === 'listItem' && node.position)
      itemLines.add(node.position.start.line - 1);
    if (
      [
        'code',
        'html',
        'yaml',
        'toml',
        'blockquote',
        'inlineCode',
        'link',
        'image',
        'definition',
        'thematicBreak',
      ].includes(node.type)
    ) {
      if (node.position) {
        for (
          let line =
            node.position.start.line -
            (['inlineCode', 'link', 'image', 'definition'].includes(node.type)
              ? 0
              : 1);
          line < node.position.end.line;
          line++
        ) {
          protectedLines.add(line);
        }
      }
      return;
    }
    if (node.type === 'list' && !insideList) lists.push(node);
    for (const child of node.children ?? [])
      visit(child, insideList || node.type === 'list');
  };
  visit(tree);

  for (const list of lists) {
    const stack: {
      original: number;
      normalized: number;
      markerWidth: number;
    }[] = [];
    let fence: { character: string; length: number } | undefined;
    for (
      let index = (list.position?.start.line ?? 1) - 1;
      index < (list.position?.end.line ?? 0);
      index++
    ) {
      const line = lines[index];
      const prefix = getPrefix(line);
      const indent = columns(prefix);
      const marker = /^(?:[-+*]|\d+[.)])(?:[\t ]+|$)/u.exec(
        line.slice(prefix.length),
      );
      const delimiter = /^(`{3,}|~{3,})(.*)$/u.exec(
        line.slice(prefix.length + (marker?.[0].length ?? 0)),
      );
      const insideFence = fence !== undefined;
      fence = nextFence(fence, delimiter);
      const isItem =
        itemLines.has(index) ||
        fencedItemLines.has(index) ||
        (!insideFence && !protectedLines.has(index));
      const target = targetIndent(
        stack,
        indent,
        isItem ? marker?.[0] : undefined,
        unit,
        Boolean(line.trim()),
      );
      const owner = stack.at(-1);
      const container = owner ? owner.original + owner.markerWidth : 0;
      const preserveContent =
        protectedLines.has(index) || insideFence || delimiter;
      const boundary = preserveContent ? Math.min(indent, container) : indent;
      const replacement =
        makePrefix(target - indent + boundary, tabs) +
        removeColumns(prefix, boundary);
      if (line.trim()) lines[index] = replacement + line.slice(prefix.length);
    }
  }
  return lines.join('\n');
};

export const formatMarkdown = async (
  input: string,
  options: MarkdownOptions,
): Promise<string> => {
  // Keep multi-line comments opaque even where the Markdown parser treats a
  // second comment on the same line as paragraph text.
  const comments: { text: string; prefix: string }[] = [];
  let token = 'OBSIDIAN_PRETTIER_COMMENT';
  while (input.includes(token)) token += '_';
  // ES2020 library target: the global regex provides replaceAll semantics.
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  let masked = input.replace(/<!--[\s\S]*?-->/gu, (comment, offset: number) => {
    const line = input.slice(input.lastIndexOf('\n', offset - 1) + 1, offset);
    comments.push({ prefix: getPrefix(line), text: comment });
    return `<!--${token}${comments.length - 1}-->`;
  });
  // A skipped indentation level can make CommonMark classify a fenced list
  // item as indented code. Repair its structural marker while the delimiter is
  // still visible, then keep the complete fence opaque to Prettier.
  const fencesBeforeRepair = fencedListItems(masked);
  if (fencesBeforeRepair.length > 0) {
    const originalLines = masked.split('\n');
    masked = await normalizeLists(
      masked,
      options.useTabs ? 4 : Math.max(2, options.tabWidth),
      false,
    );
    const repairedLines = masked.split('\n');
    const repairedFences = fencedListItems(masked);
    for (const [index, after] of repairedFences.entries()) {
      const before = fencesBeforeRepair[index];
      if (before) {
        const shift =
          columns(getPrefix(repairedLines[after.start.line - 1])) -
          columns(getPrefix(originalLines[before.start.line - 1]));
        shiftWhitespaceLines(
          repairedLines,
          after.start.line,
          after.end.line - 1,
          shift,
        );
      }
    }
    masked = repairedLines.join('\n');
  }
  for (const { start, end } of fencedListItems(masked).reverse()) {
    comments.push({
      prefix: getPrefix(
        masked.slice(
          masked.lastIndexOf('\n', start.offset - 1) + 1,
          start.offset,
        ),
      ),
      text: masked.slice(start.offset, end.offset),
    });
    masked = `${masked.slice(0, start.offset)}<!--${token}${comments.length - 1}-->${masked.slice(end.offset)}`;
  }
  const protectedBlocks = await unsafeCodeBlocks(masked);
  for (const { start, end } of protectedBlocks.reverse()) {
    comments.push({
      prefix: getPrefix(
        masked.slice(
          masked.lastIndexOf('\n', start.offset - 1) + 1,
          start.offset,
        ),
      ),
      text: masked.slice(start.offset, end.offset),
    });
    masked = `${masked.slice(0, start.offset)}<!--${token}${comments.length - 1}-->${masked.slice(end.offset)}`;
  }
  const unit = options.useTabs ? 4 : Math.max(2, options.tabWidth);
  // Repair before identifying inline code: deeply indented fences may initially
  // be parsed as inline backticks instead of fenced code blocks.
  const text = await normalizeLists(masked, unit, false);
  const tree = await parseMarkdown(text);
  const hasMultilineCode = (node: MarkdownNode): boolean =>
    (['inlineCode', 'link', 'image', 'definition'].includes(node.type) &&
      node.position?.start.line !== node.position?.end.line) ||
    (node.children ?? []).some((child) => hasMultilineCode(child));
  // Prettier 3.5 changes multiline inline-code indentation on every save.
  // Leave only affected top-level blocks untouched, formatting the rest normally.
  let safeText = text;
  for (const node of [...(tree.children ?? [])].reverse()) {
    if (hasMultilineCode(node) && node.position) {
      const { start, end } = node.position;
      comments.push({ prefix: '', text: text.slice(start.offset, end.offset) });
      safeText = `${safeText.slice(
        0,
        start.offset,
      )}<!--${token}${comments.length - 1}-->${safeText.slice(end.offset)}`;
    }
  }
  const formatted = await prettier.format(safeText, {
    embeddedLanguageFormatting: 'off',
    parser: 'markdown',
    plugins: [markdownPlugin],
    // Prettier's Markdown printer adds content indentation using tabWidth even
    // though an unordered marker occupies two columns. Its canonical width of
    // two preserves nested code content; the final pass sets hierarchy width.
    tabWidth: 2,
    useTabs: false,
  });
  let result = await normalizeLists(formatted, unit, options.useTabs);
  // Expand outer placeholders first, then inner comments. Move each comment's
  // continuation lines with its first line, retaining relative code whitespace.
  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    result = result.replace(`<!--${token}${index}-->`, (_, offset: number) => {
      const line = result.slice(
        result.lastIndexOf('\n', offset - 1) + 1,
        offset,
      );
      const prefix = /^[\t ]*/u.exec(line)?.[0] ?? '';
      const originalColumns = columns(comment.prefix);
      return comment.text
        .split('\n')
        .map((part, lineIndex) => {
          if (lineIndex === 0) return part;
          const oldPrefix = /^[\t ]*/u.exec(part)?.[0] ?? '';
          if (columns(oldPrefix) < originalColumns) return part;
          return (
            prefix +
            removeColumns(oldPrefix, originalColumns) +
            part.slice(oldPrefix.length)
          );
        })
        .join('\n');
    });
  }
  return result;
};
