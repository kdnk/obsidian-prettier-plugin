import { Plugin } from 'obsidian';

import { formatChanges } from './editor-changes.js';
import { formatMarkdown } from './format-markdown.js';
import { formattingScrollSnapshot } from './formatting-scroll.js';

import PrettierSettingTab from './prettier-setting-tab.js';

interface PrettierPluginSettings {
  tabWidth: number;
  useTabs: boolean;
}

const DEFAULT_SETTINGS: PrettierPluginSettings = {
  tabWidth: 4,
  useTabs: true,
};

export default class PrettierPlugin extends Plugin {
  settings: PrettierPluginSettings;

  async format() {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor || !editor.cm) {
      return;
    }
    const view = editor.cm;

    const file = this.app.workspace.getActiveFile();
    const path = file?.path;
    const text = editor.getValue();
    if (text && file) {
      const isCurrent = () =>
        this.app.workspace.activeEditor?.editor === editor &&
        editor.cm === view &&
        this.app.workspace.getActiveFile() === file &&
        file.path === path &&
        editor.getValue() === text;
      const formattedText = await formatMarkdown(text, {
        tabWidth:
          this.app.vault.getConfig('tabSize') ?? DEFAULT_SETTINGS.tabWidth,
        useTabs: this.app.vault.getConfig('useTab') ?? DEFAULT_SETTINGS.useTabs,
      });
      if (!isCurrent()) return;
      const changes = formatChanges(text, formattedText);
      if (changes.length > 0) {
        const snapshot = formattingScrollSnapshot(view);
        // Layout measurement can synchronously run other editor callbacks.
        if (!isCurrent()) return;
        const changeSet = view.state.changes(changes);
        view.dispatch({
          changes: changeSet,
          // Effects refer to the document after its changes.
          effects: snapshot?.map(changeSet),
          filter: false,
        });
      }
    }
  }

  onload() {
    // eslint-disable-next-line no-console
    console.log('loading prettier-format');
    this.loadSettings();

    this.addSettingTab(new PrettierSettingTab(this.app, this));
    this.addCommands();
  }

  private addCommands() {
    this.addCommand({
      editorCheckCallback: (checking, _, context) => {
        const { file } = context;

        if (!file) {
          return false;
        }

        if (checking) {
          return true;
        }

        this.format();

        return true;
      },
      id: 'format-file',
      name: 'Format current file',
    });
  }

  loadSettings() {
    this.settings = {
      tabWidth:
        this.app.vault.getConfig('tabSize') ?? DEFAULT_SETTINGS.tabWidth,
      useTabs: this.app.vault.getConfig('useTab') ?? DEFAULT_SETTINGS.useTabs,
    };
  }
}
