import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fromMarkdown } from 'mdast-util-from-markdown';

const source = buildSync({
  entryPoints: ['src/format-markdown.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
}).outputFiles[0].text;
const { formatMarkdown } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const options = { tabWidth: 4, useTabs: true };

for (const input of [
  '- root\n    - a\n      ```makefile\n      target:\n      \techo hi\n      ```\n',
  '```html\n<!--\n\tkeep tab\n-->\n```\n',
]) {
  test(`preserve code value: ${JSON.stringify(input)}`, async () => {
    const values = async (text) => {
      const result = [];
      const visit = (node) => {
        if (node.type === 'code') result.push(node.value);
        for (const child of node.children ?? []) visit(child);
      };
      visit(fromMarkdown(text));
      return result;
    };
    const actual = await formatMarkdown(input, options);
    assert.deepEqual(await values(actual), await values(input));
    assert.equal(await formatMarkdown(actual, options), actual);
  });
}

test('nested opaque blocks restore their comments', async () => {
  const input = 'text `multi\nline` <!-- keep me -->\n';
  assert.equal(await formatMarkdown(input, options), input);
});

test('multiline reference definition remains a definition', async () => {
  const input =
    '- root\n    - child\n\n      [link]: url\n        "title\n          - literal\n        end"\n';
  assert.equal(await formatMarkdown(input, options), input);
});

for (const [name, input, expected] of [
  [
    'link title remains a link',
    '- root\n    [link](url "title\n        - not a list\n    end")\n',
    '- root\n    [link](url "title\n        - not a list\n    end")\n',
  ],
  [
    'HTML item retains its child',
    '- <div>\n  hi\n  </div>\n\n  - child\n',
    '- <div>\n  hi\n  </div>\n\n\t- child\n',
  ],
  [
    'quote item retains its child',
    '- root\n    - > quote\n      - child\n',
    '- root\n\t- > quote\n\t\t- child\n',
  ],
  [
    'nested fenced comment preserves code',
    '- root\n    - child\n      ```html\n      <!--\n      some text\n      -->\n      ```\n',
    '- root\n\t- child\n\t  ```html\n\t  <!--\n\t  some text\n\t  -->\n\t  ```\n',
  ],
]) {
  test(name, async () => {
    const actual = await formatMarkdown(input, options);
    assert.equal(actual, expected);
    assert.equal(await formatMarkdown(actual, options), expected);
  });
}

for (const [name, input, expected] of [
  ['space jump', '- xxx\n        - yyyyy', '- xxx\n\t- yyyyy\n'],
  [
    'tab jump',
    '- root\n\t\t- child\n\t\t- sibling',
    '- root\n\t- child\n\t- sibling\n',
  ],
  [
    'subtree and dedent',
    '- root\n        - child\n            - grand\n        - sibling\n- next',
    '- root\n\t- child\n\t\t- grand\n\t- sibling\n- next\n',
  ],
  [
    'valid deep nesting',
    '- root\n\t- child\n\t\t- grand\n\t\t\t- great',
    '- root\n\t- child\n\t\t- grand\n\t\t\t- great\n',
  ],
  [
    'mixed indentation',
    '- root\n\t \t- child\n\t \t- sibling',
    '- root\n\t- child\n\t- sibling\n',
  ],
  ['remainder spaces', '- root\n     - child', '- root\n\t- child\n'],
  [
    'task items',
    '- [ ] root\n        - [x] child',
    '- [ ] root\n\t- [x] child\n',
  ],
  [
    'ordered list',
    '1. root\n        1. child\n        2. sibling',
    '1. root\n\t1. child\n\t2. sibling\n',
  ],
  // Prettier makes this a loose list; two spaces align text after the marker.
  [
    'paragraph follows shifted item',
    '- root\n        - child\n\n          continuation',
    '- root\n\n\t- child\n\n\t  continuation\n',
  ],
  [
    'table still formatted',
    '| a | longer |\n| - | - |\n| x | y |',
    '| a   | longer |\n| --- | ------ |\n| x   | y      |\n',
  ],
]) {
  test(name, async () => {
    const actual = await formatMarkdown(input, options);
    assert.equal(actual, expected);
    assert.equal(
      await formatMarkdown(actual, options),
      expected,
      'second save is stable',
    );
  });
}

for (const input of [
  '```md\n- root\n        - code\n```\n',
  '    - root\n            - code\n',
  '<pre>\n\n- root\n        - html\n</pre>\n',
  '<!-- first --> <!--\n- root\n        - comment\n-->\n',
  '---\ntags:\n  - root\n  - child\n---\n',
]) {
  test(`protect non-list text: ${JSON.stringify(input)}`, async () => {
    assert.equal(await formatMarkdown(input, options), input);
  });
}

test('space setting keeps spaces while repairing the hierarchy', async () => {
  assert.equal(
    await formatMarkdown('- root\n        - child', {
      tabWidth: 4,
      useTabs: false,
    }),
    '- root\n    - child\n',
  );
});

test('different tab width still has one tab per unordered-list level', async () => {
  assert.equal(
    await formatMarkdown('- root\n        - child', {
      tabWidth: 2,
      useTabs: true,
    }),
    '- root\n\t- child\n',
  );
});

for (const [name, input, expected] of [
  [
    'fence under repaired child',
    '- root\n        - child\n          ```text\n          - literal\n                  - deeper literal\n          ```\n',
    '- root\n\t- child\n\t  ```text\n\t  - literal\n\t          - deeper literal\n\t  ```\n',
  ],
  [
    'nested indented code',
    '- root\n    - child\n\n          - literal\n',
    '- root\n\n\t- child\n\n\t      - literal\n',
  ],
  [
    'long ordered marker',
    '100. root\n            - child\n',
    '100. root\n\t\t- child\n',
  ],
  [
    'inline code across lines',
    '- root `example\n        - literal`\n',
    '- root `example\n        - literal`\n',
  ],
  [
    'comment inside fence',
    '```html\n<!--\n- root\n        - literal\n-->\n```\n',
    '```html\n<!--\n- root\n        - literal\n-->\n```\n',
  ],
  ['quoted list', '> - root\n>     - child\n', '> - root\n>   - child\n'],
]) {
  test(name, async () => {
    const actual = await formatMarkdown(input, options);
    assert.equal(actual, expected);
    assert.equal(
      await formatMarkdown(actual, options),
      expected,
      'second save is stable',
    );
  });
}

// This parser is independent of Prettier's older Markdown parser. Using the
// formatter's own AST as the oracle misses code that it already reads as prose.
const codeInLists = (text) => {
  const result = [];
  const visit = (node, listDepth = 0) => {
    if (node.type === 'code') result.push({ value: node.value, listDepth });
    for (const child of node.children ?? [])
      visit(child, listDepth + (node.type === 'listItem' ? 1 : 0));
  };
  visit(fromMarkdown(text));
  return result;
};
for (const useTabs of [false, true]) {
  for (const tabWidth of [2, 4]) {
    test(`ordered indented code keeps its value and list owner (${useTabs}, ${tabWidth})`, async () => {
      const input =
        '1. root\n\n       const a = 1;\n       const b = 2;\n\n2. next\n';
      const expected = [{ value: 'const a = 1;\nconst b = 2;', listDepth: 1 }];
      assert.deepEqual(codeInLists(input), expected);
      let output = input;
      for (let pass = 0; pass < 3; pass++) {
        output = await formatMarkdown(output, { useTabs, tabWidth });
        assert.deepEqual(codeInLists(output), expected);
      }
      assert.equal(await formatMarkdown(output, { useTabs, tabWidth }), output);
    });
  }
}

test('protect ambiguous ordered code while formatting surrounding blocks', async () => {
  const code = '1. root\n\n       literal <!-- keep -->\n\n2. next';
  const input = `#   Heading\n\n${code}\n\n| a | longer |\n| - | - |\n| x | y |\n`;
  const output = await formatMarkdown(input, options);
  assert.deepEqual(codeInLists(output), [
    { value: 'literal <!-- keep -->', listDepth: 1 },
  ]);
  assert.match(output, /^# Heading\n/);
  assert.match(output, /\| a   \| longer \|/);
  assert.equal(await formatMarkdown(output, options), output);
  assert.ok(!output.includes('OBSIDIAN_PRETTIER_COMMENT'));
});

for (const input of [
  '---\na: |\n    first\n\n    second\n---\n',
  '---\na: |+\n    first\n\n\n---\n',
  '1. root\n\n       a\n\n2. next\n\n# Heading\n\n1. root\n\n       b\n',
]) {
  test(`code protection preserves adjacent source blocks: ${JSON.stringify(input)}`, async () => {
    const output = await formatMarkdown(input, options);
    assert.equal(output, input);
    assert.equal(await formatMarkdown(output, options), input);
  });
}

for (const indent of [1, 2, 3]) {
  test(`protected list keeps its ${indent}-space outer indentation`, async () => {
    const prefix = ' '.repeat(indent);
    const input = `${prefix}1. root\n\n${prefix}       a\n\n${prefix}2. next\n`;
    const output = await formatMarkdown(input, options);
    assert.equal(output, input);
    assert.deepEqual(codeInLists(output), [{ value: 'a', listDepth: 1 }]);
    assert.equal(await formatMarkdown(output, options), output);
  });
}

for (const input of [
  ' 123. item\n\n     a\n     b\n\n 123. next\n',
  '1. root\n123. item\n\n    a\n    b\n\n123. next\n',
]) {
  test(`ambiguous standalone code keeps its surrounding list context: ${JSON.stringify(input)}`, async () => {
    const output = await formatMarkdown(input, options);
    assert.equal(output, input);
    assert.deepEqual(codeInLists(output), codeInLists(input));
    assert.equal(await formatMarkdown(output, options), output);
  });
}
