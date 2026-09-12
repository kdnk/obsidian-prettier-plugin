// Run after npm run build. Only the neighboring Bullet test vault is touched.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  evaluate,
} = require('../../obsidian-bullet/scripts/obsidian-scroll-driver.cjs');
const note = `prettier-format-${randomUUID()}.md`;
const stateBundle = require.resolve('@codemirror/state');
const before =
  '---\ntags:\n  - kept\n---\n- work\n        - project\n            - task\n        - other\n- personal';
const after =
  '---\ntags:\n  - kept\n---\n\n- work\n\t- project\n\t\t- task\n\t- other\n- personal\n';
const codeLines = Array.from(
  { length: 60 },
  (_, index) => `line ${String(index + 1).padStart(2, '0')}`,
);
codeLines[10] += '  ';
const fencedBody = (prefix) =>
  [
    ...codeLines.map((line) => `${prefix}${line}`),
    prefix,
    `${prefix}- literal list marker`,
    `${prefix}\`\`\`js`,
  ].join('\n');
const nestedBefore = `#   Heading\n\n- parent\n      - ~~~~go\n${fencedBody(
  '        ',
)}\n        ~~~~~\n      - after\n- next\n\n| a | longer |\n| - | - |\n| x | y |`;
const nestedAfter = `# Heading\n\n- parent\n\t- ~~~~go\n${fencedBody(
  '\t  ',
)}\n\t  ~~~~~\n\t- after\n- next\n\n| a   | longer |\n| --- | ------ |\n| x   | y      |\n`;
const dragBefore =
  '# Heading\n\n- parent\n\t- ~~~~go\n\t  code  \n\t  \n\t  - literal list marker\n\t  ```js\n\t  ~~~~~\n\t- after\n- next\n';
const dragMoved =
  '# Heading\n\n- parent\n\t- after\n\t\t- ~~~~go\n\t\t  code  \n\t\t  \n\t\t  - literal list marker\n\t\t  ```js\n\t\t  ~~~~~\n- next\n';
const initial = evaluate(() => app.workspace.activeLeaf.id);
const sample = () =>
  evaluate(() => {
    const editor = window.__prettierCheck.leaf.view.editor;
    const reference = editor.cm.state.doc.toString().indexOf('line 30');
    const cursor = editor.getCursor();
    const viewportTop = editor.cm.scrollDOM.getBoundingClientRect().top;
    const anchor = editor.cm.lineBlockAtHeight(
      Math.max(0, viewportTop - editor.cm.documentTop + 8),
    );
    return {
      anchorLine: editor.cm.state.doc.lineAt(anchor.from).text,
      anchorY: editor.cm.coordsAtPos(anchor.from)?.top,
      cursorCharacter: editor.getLine(cursor.line).at(cursor.ch),
      cursor,
      doc: editor.getValue(),
      zoom: editor.cm.dom.querySelector(
        '.bullet-zoom-breadcrumbs [aria-current=location]',
      )?.textContent,
      line: editor.getLine(cursor.line),
      visible: editor.cm.contentDOM.textContent,
      documentTop: editor.cm.documentTop,
      viewportTop,
      scrollTop: editor.cm.scrollDOM.scrollTop,
      referenceY: reference >= 0 ? editor.cm.coordsAtPos(reference)?.top : null,
    };
  });

try {
  evaluate(
    async (bundle, stateBundle, note, before) => {
      const source = require('fs').readFileSync(bundle, 'utf8');
      const module = { exports: {} };
      new Function('module', 'exports', 'require', source)(
        module,
        module.exports,
        (name) => {
          if (name === 'obsidian')
            return { Plugin: class {}, PluginSettingTab: class {} };
          if (name === '@codemirror/state') return require(stateBundle);
          throw Error(`Unexpected import ${name}`);
        },
      );
      // Exercise the built plugin's real format method without installing it or
      // replacing save hooks; only its unused UI base classes are stubbed.
      const plugin = Object.create(module.exports.default.prototype);
      plugin.app = app;
      plugin.settings = { tabWidth: 4, useTabs: true };
      const file = await app.vault.create(note, before);
      const leaf = app.workspace.getLeaf('tab');
      window.__prettierCheck = { plugin, leaf };
      await leaf.openFile(file);
      leaf.view.editor.setCursor({ line: 5, ch: 13 });
      app.commands.executeCommandById('bullet:zoom-in');
      await new Promise((resolve) => setTimeout(resolve, 350));
      leaf.view.editor.setCursor({ line: 5, ch: 13 });
    },
    path.resolve(__dirname, '../main.js'),
    stateBundle,
    note,
    before,
  );
  assert.equal(sample().zoom, 'project');
  evaluate(async () => {
    const { plugin, leaf } = window.__prettierCheck;
    await plugin.format();
    await leaf.view.save();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  assert.equal(sample().zoom, 'project');
  assert.equal(sample().line, '\t- project');
  assert.ok(!sample().visible.includes('personal'));
  console.log(
    'PASS real plugin formatting + save: depth repair, tabs, zoom, YAML and hidden content',
  );
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    window.__prettierCheck.leaf.view.editor.replaceSelection('X');
  });
  assert.equal(sample().line, '\t- proXject');
  evaluate(async () => {
    window.__prettierCheck.leaf.view.editor.undo();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  console.log(
    'PASS next input edits the visible item; typing Undo remains separate',
  );
  evaluate(async () => {
    const { plugin, leaf } = window.__prettierCheck;
    await plugin.format();
    leaf.view.editor.undo();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, before);
  evaluate(async () => {
    window.__prettierCheck.leaf.view.editor.redo();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  console.log(
    'PASS no-op adds no history; one Undo/Redo restores the full formatting change',
  );
  evaluate(async (nestedBefore) => {
    const { leaf } = window.__prettierCheck;
    app.commands.executeCommandById('bullet:zoom-out');
    leaf.view.editor.setValue(nestedBefore);
    await leaf.view.save();
    leaf.view.editor.setCursor({ line: 4, ch: 8 });
    app.commands.executeCommandById('bullet:zoom-in');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const scrollDOM = leaf.view.editor.cm.scrollDOM;
    scrollDOM.scrollTop = Math.min(
      500,
      scrollDOM.scrollHeight - scrollDOM.clientHeight,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, nestedBefore);
  assert.equal(sample().zoom, '~~~~go');
  const beforeNestedFormat = sample();
  assert.ok(beforeNestedFormat.scrollTop > 0);
  assert.notEqual(beforeNestedFormat.referenceY, null);
  assert.deepEqual(beforeNestedFormat.cursor, { line: 3, ch: 8 });
  assert.equal(beforeNestedFormat.cursorCharacter, '~');
  evaluate(async () => {
    const { plugin, leaf } = window.__prettierCheck;
    await plugin.format();
    await leaf.view.save();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  const afterNestedFormat = sample();
  assert.equal(afterNestedFormat.doc, nestedAfter);
  assert.equal(afterNestedFormat.zoom, '~~~~go');
  assert.deepEqual(afterNestedFormat.cursor, { line: 3, ch: 3 });
  assert.equal(afterNestedFormat.cursorCharacter, '~');
  assert.equal(afterNestedFormat.line, '\t- ~~~~go');
  assert.equal(
    afterNestedFormat.anchorLine.trim(),
    beforeNestedFormat.anchorLine.trim(),
  );
  assert.ok(
    Math.abs(afterNestedFormat.anchorY - beforeNestedFormat.anchorY) <= 2,
  );
  assert.equal(
    afterNestedFormat.scrollTop + afterNestedFormat.documentTop,
    beforeNestedFormat.scrollTop + beforeNestedFormat.documentTop,
  );
  evaluate(async () => {
    const { plugin } = window.__prettierCheck;
    await plugin.format();
  });
  assert.equal(sample().doc, nestedAfter);
  console.log(
    'PASS nested fenced item remains exact, zoomed and scroll-stable across repeated formatting',
  );
  evaluate(async (dragBefore) => {
    const { leaf } = window.__prettierCheck;
    app.commands.executeCommandById('bullet:zoom-out');
    leaf.view.editor.setValue(dragBefore);
    await leaf.view.save();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const editor = leaf.view.editor;
    const view = editor.cm;
    const source = view.state.doc.line(4).from;
    const target = view.state.doc.line(10).from;
    const sourceCoords = view.coordsAtPos(source);
    const targetCoords = view.coordsAtPos(target);
    if (!sourceCoords || !targetCoords) throw Error('Missing drag coordinates');
    const { node } = view.domAtPos(source);
    let line = node.nodeType === 1 ? node : node.parentElement;
    while (line && !line.classList.contains('cm-line'))
      line = line.parentElement;
    const marker = line?.querySelector(
      '.cm-formatting-list, .cm-fold-indicator',
    );
    if (!marker) throw Error('Missing draggable nested fence marker');
    marker.dispatchEvent(
      new MouseEvent('mousedown', {
        screenX: sourceCoords.left,
        screenY: sourceCoords.top,
        clientX: sourceCoords.left,
        clientY: sourceCoords.top,
      }),
    );
    view.dom.ownerDocument.dispatchEvent(
      new MouseEvent('mousemove', {
        screenX: targetCoords.left + 50,
        screenY: targetCoords.top + 10,
        clientX: targetCoords.left + 50,
        clientY: targetCoords.top + 10,
      }),
    );
    view.dom.ownerDocument.dispatchEvent(new MouseEvent('mouseup'));
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, dragBefore);
  assert.equal(sample().doc, dragMoved);
  console.log(
    'PASS the formatted fenced item remains one subtree during native pointer drag-and-drop',
  );
} finally {
  evaluate(
    async (initial, note) => {
      const check = window.__prettierCheck;
      if (check) {
        await check.leaf.view.save();
        check.leaf.detach();
      }
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
      const leaf = app.workspace.getLeafById(initial);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      delete window.__prettierCheck;
    },
    initial,
    note,
  );
}
