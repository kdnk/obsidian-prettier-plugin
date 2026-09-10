# Obsidian Prettier Plugin

This is a formatting plugin for [Obsidian](https://obsidian.md).

It uses the built-in settings for tabs and tab spacing so it doesn't require configuration.

# Differences from Other Projects

Unlike [alexgavrusev/obsidian-format-with-prettier](https://github.com/alexgavrusev/obsidian-format-with-prettier), there's no configuration available. The common prettier settings, tabs and number of spaces are taken from the official settings under Editor.

# Installation

Install from community plugins.

_Or_ unzip the [latest release](https://github.com/dylanarmstrong/obsidian-prettier-plugin/releases/latest) into `.obsidian/plugins` folder of your vault.

# Usage

Format on save is enabled by default, and can be changed under plugin settings.

Additionally, a "Format current file" command is available.

# Customization

This fork repairs skipped indentation levels before running Prettier, then converts list hierarchy indentation to the current Obsidian Editor setting. With tabs enabled, an eight-space child directly below a root becomes a one-tab child. Existing intermediate ancestors are retained, and descendants and continuation lines move with their owning item.

Prettier itself prints Markdown lists with spaces even with `useTabs: true`; this fork performs the final conversion. Markdown tab stops are four columns regardless of the editor's visual tab width. Spaces mode uses the configured width (minimum two). Wide ordered-list markers can require more than one tab to keep children nested.

Only structural list indentation is normalized. Marker separators and alignment spaces remain where Markdown needs them; code-content spaces and tabs are preserved. Quoted lists are left to Prettier. Indented runs recognized as code are not guessed to be malformed lists. Blocks containing multiline inline code, links, images or reference definitions are kept out of Prettier's formatting pass to avoid upstream preservation issues. Embedded code formatting is disabled.

One save applies one atomic diff and does nothing when the result is unchanged. Formatting is discarded if the text or active file/editor changes while it is running. Obsidian's current `useTab` and `tabSize` settings take precedence over legacy saved plugin values.

When Automatic Linker coordinates saving, turn off this plugin's **Format on save** and Linter's **Lint on save**; enable Automatic Linker's Prettier and Linter stages. The order remains links → Prettier → Linter. Install this fork before using an Automatic Linker version that removes its old indentation-cleanup option. Linter rules can still change the formatter's output; avoid conflicting indentation rules.

# Development checks

Run `npm test`, `npm run build`, and `npx eslint src`. Tests exercise the real bundled Prettier, indentation idempotence, code-content preservation and the plugin's editor application.

With the neighboring `obsidian-bullet` repository's guarded test vault open, run `node scripts/verify-formatting.cjs` after building. It exercises the built plugin's format method, zoom, subsequent typing and Undo/Redo in a temporary note, without installing a plugin or changing personal vaults. Only unused Obsidian UI base classes are stubbed. The temporary note is moved to the test vault's trash afterwards.

# Credits

Significant inspiration taken from [alexgavrusev/obsidian-format-with-prettier](https://github.com/alexgavrusev/obsidian-format-with-prettier) and [platers/obsidian-linter](https://github.com/platers/obsidian-linter).

# License

MIT License, for more details see [License](./LICENSE)
