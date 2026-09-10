import { App, PluginSettingTab, Setting } from 'obsidian';

import PrettierPlugin from './prettier-plugin.js';

export default class PrettierSettingTab extends PluginSettingTab {
  plugin: PrettierPlugin;

  constructor(app: App, plugin: PrettierPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('div', {
      cls: 'prettier-plugin-settings-description',
      text: 'These are the settings currently set in the "Editor" tab, please edit them there if you would like to change them.',
    });

    const { useTabs, tabWidth } = this.plugin.settings;
    new Setting(containerEl)
      .setName('Indent using tabs')
      .setDesc(
        `Use tabs to indent by pressing the "Tab" key. Turn this off to indent using ${tabWidth} spaces.`,
      )
      .setDisabled(true)
      .addToggle((component) => component.setValue(useTabs).setDisabled(true));

    new Setting(containerEl)
      .setName('Indent visual width')
      .setDesc('Number of spaces a tab character will render as.')
      .addSlider((component) =>
        component.setValue(tabWidth).setDisabled(true).setDynamicTooltip(),
      );
  }
}
