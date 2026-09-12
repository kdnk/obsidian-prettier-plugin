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

for (const [name, input] of [
  [
    'backtick fence used as a list item',
    '- aaa\n\t- ```go\n\t  aaa  \n\t  \n\t  - literal list marker\n\t  ```\n-',
  ],
  [
    'tilde fence containing a fence-looking code line',
    '- parent\n\t- ~~~~go\n\t    additionally indented  \n\n\t  - literal list marker\n\t  ```js\n\t  ~~~~~\n\t- after\n- next',
  ],
  [
    'fence with an over-indented delimiter-shaped code line',
    '- parent\n\t- ~~~~\n\t  code\n\t      ~~~~\n\t  after\n\t  ~~~~',
  ],
]) {
  test(`${name} preserves its exact fenced Markdown`, async () => {
    const expected = `${input}\n`;
    const output = await formatMarkdown(input, options);
    assert.equal(output, expected);
    assert.deepEqual(codeInLists(output), codeInLists(input));
    assert.equal(await formatMarkdown(output, options), expected);
  });
}

test('repairs a skipped list depth without reprinting its fenced item', async () => {
  const input =
    '#   Heading\n\n- root\n      - ~~~~go\n        code  \n        \n        - literal\n        ~~~~~\n      - after\n\n| a | longer |\n| - | - |\n| x | y |';
  const expected =
    '# Heading\n\n- root\n\t- ~~~~go\n\t  code  \n\t  \n\t  - literal\n\t  ~~~~~\n\t- after\n\n| a   | longer |\n| --- | ------ |\n| x   | y      |\n';
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected);
  assert.deepEqual(codeInLists(output), codeInLists(expected));
  assert.equal(await formatMarkdown(output, options), expected);
});

test('preserves an unclosed fenced item through skipped-depth repair', async () => {
  const input =
    '- root\n      - ~~~~go\n        code  \n        \n        - literal\n- next\n\n#   Heading';
  const expected =
    '- root\n\t- ~~~~go\n\t  code  \n\t  \n\t  - literal\n- next\n\n# Heading\n';
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected);
  assert.deepEqual(codeInLists(output), codeInLists(expected));
  assert.equal(await formatMarkdown(output, options), expected);
});

for (const [name, input, expected] of [
  [
    'closed CRLF fence',
    '- root\r\n      - ~~~~go\r\n        code  \r\n        \r\n        ~~~~~\r\n- next',
    '- root\n\t- ~~~~go\r\n\t  code  \r\n\t  \r\n\t  ~~~~~\r\n- next\n',
  ],
  [
    'unclosed CRLF fence before a dedent',
    '- root\r\n      - ~~~~go\r\n        code  \r\n        \r\n        - literal\r\n- next',
    '- root\n\t- ~~~~go\r\n\t  code  \r\n\t  \r\n\t  - literal\r\n- next\n',
  ],
]) {
  test(`${name} preserves the fenced physical Markdown`, async () => {
    const output = await formatMarkdown(input, options);
    assert.equal(output, expected);
    assert.equal(await formatMarkdown(output, options), expected);
  });
}

test('does not protect a backtick-like item with an invalid info string', async () => {
  const input = '- ```foo`bar\n\n- parent\n    - child\n';
  const output = await formatMarkdown(input, options);
  assert.match(output, /\n\t- child\n/u);
  assert.equal(await formatMarkdown(output, options), output);
});

test('continues to format a standalone fenced block', async () => {
  const input = '~~~~js extra\ncode  \n~~~~\n';
  assert.equal(
    await formatMarkdown(input, options),
    '```js extra\ncode\n```\n',
  );
});

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
    'indented root list below a heading',
    '## メモ\n\n    \t- helloe\n    \t\t- 今日の\n    \t\t\t- he\n    \t\t\t- 今日の予定は？\n',
    '## メモ\n\n- helloe\n\t- 今日の\n\t\t- he\n\t\t- 今日の予定は？\n',
  ],
  ['single indented root', '\t- root\n', '- root\n'],
  [
    'indented root with skipped child levels',
    '    - root\n            - child\n',
    '- root\n\t- child\n',
  ],
  [
    'indented roots and descendants',
    '\t\t- root\n\t\t\t- child\n\t\t- sibling\n',
    '- root\n\t- child\n- sibling\n',
  ],
  [
    'indented ordered tasks',
    '    1. [ ] root\n            1. [x] child\n    2. [ ] next\n',
    '1. [ ] root\n\t1. [x] child\n2. [ ] next\n',
  ],
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
  '    - root\n            - code\n    console.log("keep code");\n',
  '<pre>\n\n- root\n        - html\n</pre>\n',
  '<!-- first --> <!--\n- root\n        - comment\n-->\n',
  '---\ntags:\n  - root\n  - child\n---\n',
]) {
  test(`protect non-list text: ${JSON.stringify(input)}`, async () => {
    assert.equal(await formatMarkdown(input, options), input);
  });
}

test('recovering an indented root preserves list hierarchy in an independent parser', async () => {
  const input =
    '## メモ\n\n    \t- helloe\n    \t\t- 今日の\n    \t\t\t- he\n    \t\t\t- 今日の予定は？\n';
  for (const useTabs of [false, true]) {
    for (const tabWidth of [2, 4]) {
      let output = input;
      for (let pass = 0; pass < 3; pass++) {
        output = await formatMarkdown(output, { useTabs, tabWidth });
        const items = [];
        const visit = (node, depth = 0) => {
          assert.notEqual(node.type, 'code');
          if (node.type === 'listItem') items.push(depth);
          for (const child of node.children ?? [])
            visit(child, depth + (node.type === 'listItem' ? 1 : 0));
        };
        visit(fromMarkdown(output));
        assert.deepEqual(items, [0, 1, 2, 2]);
      }
      assert.equal(await formatMarkdown(output, { useTabs, tabWidth }), output);
    }
  }
});

for (const indent of [0, 1, 2, 3]) {
  test(`root recovery keeps the following paragraph outside the list (${indent} spaces)`, async () => {
    const input = `    - root\n${' '.repeat(indent)}Following paragraph.\n`;
    const output = await formatMarkdown(input, options);
    assert.equal(output, '- root\n\nFollowing paragraph.\n');
    assert.deepEqual(
      fromMarkdown(output).children.map(({ type }) => type),
      ['list', 'paragraph'],
    );
    assert.equal(await formatMarkdown(output, options), output);
  });
}

test('root recovery leaves multiline comment contents opaque', async () => {
  const input = '<!-- first --> <!--\n    - root\n            - child\n-->\n';
  assert.equal(await formatMarkdown(input, options), input);
});

for (const input of [
  '```md\n    \t- root\n    \t\t- child\n```\n',
  '>     - root\n>         - child\n',
  '- owner\n\n      - literal\n          - nested literal\n',
  '1. owner\n\n       - literal\n           - nested literal\n',
  '    - root\n\n    ordinary code\n',
  '    - root\n    - <!--\n    ordinary code\n    -->\n',
  '    ---\n    - literal\n',
  '    1. first\n            2. literal\n            2. last\n',
  '    1. `first\n            2. literal\n            2. last`\n',
  '    1. [first](url "title\n            2. literal\n            2. last")\n',
  '---\nexample: |\n    - literal\n        - nested literal\n---\n',
]) {
  test(`root recovery preserves other code: ${JSON.stringify(input)}`, async () => {
    const output = await formatMarkdown(input, options);
    assert.deepEqual(codeInLists(output), codeInLists(input));
    assert.equal(await formatMarkdown(output, options), output);
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
