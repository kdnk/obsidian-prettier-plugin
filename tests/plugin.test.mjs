import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: ['src/prettier-plugin.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['obsidian'],
}).outputFiles[0].text;
const module = { exports: {} };
new Function('module', 'exports', 'require', source)(
  module,
  module.exports,
  (name) => {
    assert.equal(name, 'obsidian');
    return {
      Plugin: class {
        onunload() {}
      },
      PluginSettingTab: class {},
    };
  },
);

function setup() {
  const plugin = new module.exports.default();
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.addSettingTab = () => {};
  plugin.loadData = async () => ({ formatOnSave: true });
  let text = '- root\n        - child';
  const transactions = [];
  const editor = {
    getValue: () => text,
    posToOffset: ({ line, ch }) =>
      text
        .split('\n')
        .slice(0, line)
        .reduce((offset, value) => offset + value.length + 1, 0) + ch,
    cm: {
      dispatch(transaction) {
        transactions.push(transaction);
        for (const change of [...transaction.changes].reverse())
          text =
            text.slice(0, change.from) +
            (change.insert ?? '') +
            text.slice(change.to ?? change.from);
      },
    },
  };
  const file = { path: 'test.md' };
  plugin.app = {
    workspace: { activeEditor: { editor }, getActiveFile: () => file },
    vault: { getConfig: (key) => (key === 'useTab' ? true : 4) },
  };
  plugin.settings = { tabWidth: 4, useTabs: true };
  return {
    plugin,
    editor,
    file,
    transactions,
    commands,
    changeText: (value) => {
      text = value;
    },
  };
}

test('format uses repaired tabs and one atomic editor transaction', async () => {
  const { plugin, editor, transactions } = setup();
  await plugin.format();
  assert.equal(editor.getValue(), '- root\n\t- child\n');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].filter, false);
  await plugin.format();
  assert.equal(
    transactions.length,
    1,
    'unchanged formatting does not dispatch',
  );
});

test('typing while formatting never overwrites newer text', async () => {
  const { plugin, editor, changeText, transactions } = setup();
  const pending = plugin.format();
  changeText('- newer user text');
  await pending;
  assert.equal(editor.getValue(), '- newer user text');
  assert.equal(transactions.length, 0);
});

test('navigation while formatting cancels application', async () => {
  const { plugin, transactions } = setup();
  const pending = plugin.format();
  plugin.app.workspace.activeEditor = undefined;
  await pending;
  assert.equal(transactions.length, 0);
});

test('settings use Obsidian indentation and ignore legacy plugin options', async () => {
  const { plugin } = setup();
  plugin.loadData = async () => ({
    tabWidth: 2,
    useTabs: false,
    formatOnSave: true,
  });
  await plugin.loadSettings();
  assert.deepEqual(plugin.settings, {
    tabWidth: 4,
    useTabs: true,
  });
});

for (const callbackName of ['callback', 'checkCallback']) {
  test(`saving through ${callbackName} never formats or changes the save handler`, async () => {
    const { plugin, editor, transactions } = setup();
    const save = { [callbackName]: () => true };
    const original = { ...save };
    plugin.app.commands = { commands: { 'editor:save-file': save } };

    await plugin.onload();
    if (save.checkCallback) save.checkCallback(false);
    else save.callback();
    await new Promise(setImmediate);

    assert.equal(editor.getValue(), '- root\n        - child');
    assert.equal(transactions.length, 0);
    assert.deepEqual(save, original);
    plugin.onunload();
    assert.deepEqual(save, original);
  });
}

test('the manual command still formats after plugin load', async () => {
  const { plugin, editor, file, commands } = setup();
  await plugin.onload();
  const command = commands.find(({ id }) => id === 'format-file');
  assert.equal(command.editorCheckCallback(true, editor, { file }), true);
  assert.equal(editor.getValue(), '- root\n        - child');
  assert.equal(command.editorCheckCallback(false, editor, { file }), true);
  await new Promise(setImmediate);
  assert.equal(editor.getValue(), '- root\n\t- child\n');
});
