import * as markdownPlugin from 'prettier/plugins/markdown';
import * as prettier from 'prettier/standalone';

export interface MarkdownOptions {
  tabWidth: number;
  useTabs: boolean;
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: {
    start: { line: number; offset: number };
    end: { line: number; offset: number };
  };
}

// The standalone Markdown parser does not consume formatter options.
const parseMarkdown = markdownPlugin.parsers.markdown.parse as (
  text: string,
) => MarkdownNode | Promise<MarkdownNode>;

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
      const delimiter = /^(`{3,}|~{3,})(.*)$/u.exec(line.slice(prefix.length));
      const insideFence = fence !== undefined;
      fence = nextFence(fence, delimiter);
      const marker = /^(?:[-+*]|\d+[.)])(?:[\t ]+|$)/u.exec(
        line.slice(prefix.length),
      );
      const isItem =
        itemLines.has(index) || (!insideFence && !protectedLines.has(index));
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
  const masked = input.replace(
    /<!--[\s\S]*?-->/gu,
    (comment, offset: number) => {
      const line = input.slice(input.lastIndexOf('\n', offset - 1) + 1, offset);
      comments.push({ prefix: getPrefix(line), text: comment });
      return `<!--${token}${comments.length - 1}-->`;
    },
  );
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
