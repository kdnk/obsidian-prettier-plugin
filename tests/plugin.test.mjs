import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EditorSelection, EditorState } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');

const source = buildSync({
  entryPoints: ['src/prettier-plugin.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['obsidian', '@codemirror/state'],
}).outputFiles[0].text;
const module = { exports: {} };
new Function('module', 'exports', 'require', source)(
  module,
  module.exports,
  (name) => {
    if (name === '@codemirror/state') return require(name);
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
  const snapshots = [];
  const editor = {
    getValue: () => text,
    posToOffset: ({ line, ch }) =>
      text
        .split('\n')
        .slice(0, line)
        .reduce((offset, value) => offset + value.length + 1, 0) + ch,
    cm: {
      state: EditorState.create({ doc: text }),
      scrollDOM: {
        scrollTop: 900,
        scrollLeft: 17,
        getBoundingClientRect: () => ({ top: 80 }),
      },
      dom: { ownerDocument: { defaultView: { devicePixelRatio: 1 } } },
      documentTop: -800,
      lineBlockAtHeight: () => ({ from: 0, top: 0 }),
      viewState: { scrollAnchorAt: () => ({ from: 0, top: 0 }) },
      scrollSnapshot() {
        snapshots.push({ text, scrollTop: this.scrollDOM.scrollTop });
        return EditorView.prototype.scrollSnapshot.call(this);
      },
      dispatch(transaction) {
        transactions.push(transaction);
        this.state = this.state.update(transaction).state;
        text = this.state.doc.toString();
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
    snapshots,
    commands,
    changeText: (value) => {
      text = value;
      editor.cm.state = EditorState.create({ doc: text });
    },
  };
}

test('format uses repaired tabs and one atomic editor transaction', async () => {
  const { plugin, editor, transactions, snapshots } = setup();
  await plugin.format();
  assert.equal(editor.getValue(), '- root\n\t- child\n');
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].filter, false);
  assert.equal(snapshots.length, 1);
  await plugin.format();
  assert.equal(
    transactions.length,
    1,
    'unchanged formatting does not dispatch',
  );
  assert.equal(
    snapshots.length,
    1,
    'unchanged formatting does not capture scroll',
  );
});

test('format repairs an indented root through the awaitable plugin API', async () => {
  const { plugin, editor, transactions, changeText } = setup();
  changeText(
    '## メモ\n\n    \t- helloe\n    \t\t- 今日の\n    \t\t\t- he\n    \t\t\t- 今日の予定は？\n',
  );
  await plugin.format();
  assert.equal(
    editor.getValue(),
    '## メモ\n\n- helloe\n\t- 今日の\n\t\t- he\n\t\t- 今日の予定は？\n',
  );
  assert.equal(transactions.length, 1);
  await plugin.format();
  assert.equal(transactions.length, 1);
});

// DOM geometry is supplied here; effect creation and change/selection mapping
// use real CodeMirror. Live Obsidian tests cover widget layout and rendering.
for (const propertiesHeight of [0, 673]) {
  for (const widgetHeight of [44, 900]) {
    for (const cursor of ['above', 'below']) {
      test(`format preserves the visible block with properties ${propertiesHeight}, widget ${widgetHeight}, cursor ${cursor}`, async () => {
        const { plugin, editor, transactions, changeText } = setup();
        const text =
          '- root\n        - child\n\nvisible paragraph\n\nlast paragraph';
        changeText(text);
        const view = editor.cm;
        const visibleFrom = text.indexOf('visible');
        const cursorFrom = cursor === 'above' ? 0 : text.length;
        view.state = view.state.update({
          selection: EditorSelection.cursor(cursorFrom),
        }).state;
        const before = view.state;
        const blockTop = widgetHeight + 100;
        const scrollTop = propertiesHeight + blockTop + 12;
        view.scrollDOM.scrollTop = scrollTop;
        view.documentTop = 80 + propertiesHeight - scrollTop;
        view.lineBlockAtHeight = (height) => {
          if (height === 0) return { from: 0, top: 0 };
          assert.ok(height >= blockTop && height < blockTop + 30);
          return { from: visibleFrom, top: blockTop };
        };
        // Native snapshots choose a different anchor when properties offset
        // cm-content. A corrected snapshot must refer to the visible paragraph.
        view.viewState.scrollAnchorAt = () => ({
          from: text.length,
          top: blockTop + 300,
        });

        await plugin.format();

        const spec = transactions[0];
        assert.ok(spec.effects, 'formatting must carry a scroll snapshot');
        const effects = Array.isArray(spec.effects)
          ? spec.effects
          : [spec.effects];
        const snapshot = effects[0].value;
        const changes = before.changes(spec.changes);
        assert.equal(snapshot.range.head, changes.mapPos(visibleFrom));
        assert.equal(
          snapshot.isSnapshot,
          true,
          'preserve the view without revealing the cursor',
        );
        assert.equal(snapshot.yMargin, blockTop - scrollTop);
        assert.equal(snapshot.xMargin, 17);
        assert.notEqual(spec.scrollIntoView, true);
        assert.equal(
          view.state.selection.main.head,
          changes.mapPos(cursorFrom),
        );
      });
    }
  }
}

test('scroll is captured after asynchronous formatting, using the latest viewport', async () => {
  const { plugin, editor, snapshots } = setup();
  const pending = plugin.format();
  editor.cm.scrollDOM.scrollTop = 1234;
  await pending;
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].scrollTop, 1234);
});

test('formatting remains available when an older editor lacks scroll snapshots', async () => {
  const { plugin, editor } = setup();
  editor.cm.scrollSnapshot = undefined;
  await plugin.format();
  assert.equal(editor.getValue(), '- root\n\t- child\n');
});

test('fractional anchor offsets are rounded to physical pixels', async () => {
  const { plugin, editor, transactions } = setup();
  editor.cm.dom.ownerDocument.defaultView.devicePixelRatio = 2;
  editor.cm.lineBlockAtHeight = () => ({ from: 0, top: 26.375 });
  await plugin.format();
  const effects = transactions[0].effects;
  assert.ok(effects, 'formatting must carry a scroll snapshot');
  assert.equal(
    (Array.isArray(effects) ? effects[0] : effects).value.yMargin,
    -873.5,
  );
});

test('pending widget measurements settle before capturing the viewport', async () => {
  const { plugin, editor, snapshots, transactions } = setup();
  const view = editor.cm;
  // CodeMirror's measured read can adjust scrolling after widget layout changes.
  view.lineBlockAtHeight = () => {
    view.scrollDOM.scrollTop = 1000;
    view.documentTop = -900;
    return { from: 0, top: 100 };
  };
  await plugin.format();
  assert.equal(snapshots[0].scrollTop, 1000);
  assert.equal(transactions[0].effects.value.yMargin, -900);
});

for (const change of ['text', 'navigation']) {
  test(`a ${change} change during layout measurement cancels formatting`, async () => {
    const { plugin, editor, transactions, changeText } = setup();
    editor.cm.lineBlockAtHeight = () => {
      if (change === 'text') changeText('- newer user text');
      else plugin.app.workspace.activeEditor = undefined;
      return { from: 0, top: 0 };
    };
    await plugin.format();
    assert.equal(transactions.length, 0);
    if (change === 'text') assert.equal(editor.getValue(), '- newer user text');
  });
}

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
