import { Plugin } from 'obsidian';

import { formatChanges } from './editor-changes.js';
import { formatMarkdown } from './format-markdown.js';

import PrettierSettingTab from './prettier-setting-tab.js';

interface PrettierPluginSettings {
  formatOnSave: boolean;
  tabWidth: number;
  useTabs: boolean;
}

const DEFAULT_SETTINGS: PrettierPluginSettings = {
  formatOnSave: true,
  tabWidth: 4,
  useTabs: true,
};

export default class PrettierPlugin extends Plugin {
  settings: PrettierPluginSettings;
  originalCheckCallback?: (checking: boolean) => boolean | void;
  originalCallback?: () => void;

  private async format() {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor || !editor.cm) {
      return;
    }

    const file = this.app.workspace.getActiveFile();
    const path = file?.path;
    const text = editor.getValue();
    if (text && file) {
      const formattedText = await formatMarkdown(text, {
        tabWidth:
          this.app.vault.getConfig('tabSize') ?? DEFAULT_SETTINGS.tabWidth,
        useTabs: this.app.vault.getConfig('useTab') ?? DEFAULT_SETTINGS.useTabs,
      });
      if (
        this.app.workspace.activeEditor?.editor !== editor ||
        this.app.workspace.getActiveFile() !== file ||
        file.path !== path ||
        editor.getValue() !== text
      )
        return;
      const changes = formatChanges(text, formattedText);
      if (changes.length > 0) editor.cm.dispatch({ changes, filter: false });
    }
  }

  private getSave() {
    return this.app.commands?.commands?.['editor:save-file'];
  }

  private onFileSave() {
    if (this.settings.formatOnSave) {
      this.format();
    }
  }

  private patchSave() {
    const handleSave = this.getSave();

    if (!handleSave) {
      return;
    }

    this.originalCallback = handleSave.callback;
    this.originalCheckCallback = handleSave.checkCallback;

    handleSave.checkCallback = (checking: boolean) => {
      // If checkCallback is defined (i.e. obsidian > 1.9.0)
      if (this.originalCheckCallback) {
        this.originalCheckCallback.apply(handleSave, [checking]);
      } else if (this.originalCallback) {
        // Otherwise call original callback method.
        // Note: this won't be called normally if checkCallback is defined
        this.originalCallback.apply(handleSave);
      }

      this.onFileSave();
    };
  }

  private revertSave() {
    const handleSave = this.getSave();

    if (!handleSave || !this.originalCheckCallback) {
      return;
    }

    handleSave.checkCallback = this.originalCheckCallback;
  }

  async onload() {
    // eslint-disable-next-line no-console
    console.log('loading prettier-format');
    await this.loadSettings();

    this.patchSave();
    this.addSettingTab(new PrettierSettingTab(this.app, this));
    this.addCommands();
  }

  onunload() {
    this.revertSave();
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

  async loadSettings() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData()),
      tabWidth:
        this.app.vault.getConfig('tabSize') ?? DEFAULT_SETTINGS.tabWidth,
      useTabs: this.app.vault.getConfig('useTab') ?? DEFAULT_SETTINGS.useTabs,
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
