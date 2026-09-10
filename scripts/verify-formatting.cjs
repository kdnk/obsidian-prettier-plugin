// Run after npm run build. Only the neighboring Bullet test vault is touched.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { evaluate } = require('../../obsidian-bullet/scripts/obsidian-scroll-driver.cjs');
const note = `prettier-format-${randomUUID()}.md`;
const before = '---\ntags:\n  - kept\n---\n- work\n        - project\n            - task\n        - other\n- personal';
const after = '---\ntags:\n  - kept\n---\n\n- work\n\t- project\n\t\t- task\n\t- other\n- personal\n';
const initial = evaluate(() => app.workspace.activeLeaf.id);
const sample = () => evaluate(() => {
  const editor = window.__prettierCheck.leaf.view.editor;
  return {
    doc: editor.getValue(),
    zoom: editor.cm.dom.querySelector('.bullet-zoom-breadcrumbs [aria-current=location]')?.textContent,
    line: editor.getLine(editor.getCursor().line),
    visible: editor.cm.contentDOM.textContent,
  };
});

try {
  evaluate(async (bundle, note, before) => {
    const source = require('fs').readFileSync(bundle, 'utf8');
    const module = { exports: {} };
    new Function('module', 'exports', 'require', source)(module, module.exports, (name) => {
      if (name !== 'obsidian') throw Error(`Unexpected import ${name}`);
      return { Plugin: class {}, PluginSettingTab: class {} };
    });
    // Exercise the built plugin's real format method without installing it or
    // replacing save hooks; only its unused UI base classes are stubbed.
    const plugin = Object.create(module.exports.default.prototype);
    plugin.app = app;
    plugin.settings = { tabWidth: 4, useTabs: true, formatOnSave: false };
    const file = await app.vault.create(note, before);
    const leaf = app.workspace.getLeaf('tab');
    window.__prettierCheck = { plugin, leaf };
    await leaf.openFile(file);
    leaf.view.editor.setCursor({ line: 5, ch: 13 });
    app.commands.executeCommandById('bullet:zoom-in');
    await new Promise(resolve => setTimeout(resolve, 350));
    leaf.view.editor.setCursor({ line: 5, ch: 13 });
  }, path.resolve(__dirname, '../main.js'), note, before);
  assert.equal(sample().zoom, 'project');
  evaluate(async () => {
    const { plugin, leaf } = window.__prettierCheck;
    await plugin.format();
    await leaf.view.save();
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  assert.equal(sample().zoom, 'project');
  assert.equal(sample().line, '\t- project');
  assert.ok(!sample().visible.includes('personal'));
  console.log('PASS real plugin formatting + save: depth repair, tabs, zoom, YAML and hidden content');
  evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 600));
    window.__prettierCheck.leaf.view.editor.replaceSelection('X');
  });
  assert.equal(sample().line, '\t- proXject');
  evaluate(async () => {
    window.__prettierCheck.leaf.view.editor.undo();
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  console.log('PASS next input edits the visible item; typing Undo remains separate');
  evaluate(async () => {
    const { plugin, leaf } = window.__prettierCheck;
    await plugin.format();
    leaf.view.editor.undo();
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, before);
  evaluate(async () => {
    window.__prettierCheck.leaf.view.editor.redo();
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  assert.equal(sample().doc, after);
  console.log('PASS no-op adds no history; one Undo/Redo restores the full formatting change');
} finally {
  evaluate(async (initial, note) => {
    const check = window.__prettierCheck;
    if (check) { await check.leaf.view.save(); check.leaf.detach(); }
    const file = app.vault.getAbstractFileByPath(note);
    if (file) await app.vault.trash(file, true);
    const leaf = app.workspace.getLeafById(initial);
    if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    delete window.__prettierCheck;
  }, initial, note);
}
