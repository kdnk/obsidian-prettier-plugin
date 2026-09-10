import 'obsidian';
import { EditorView } from '@codemirror/view';

declare module 'obsidian' {
  interface Editor {
    cm?: EditorView;
  }

  interface Vault {
    getConfig(id: 'tabSize'): number | undefined;
    getConfig(id: 'useTab'): boolean | undefined;
  }
}
