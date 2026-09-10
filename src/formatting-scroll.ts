import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const correctSnapshotAnchor = (view: EditorView, value: unknown) => {
  // CodeMirror exposes the effect, but keeps its value type internal. Keep the
  // Obsidian-specific correction guarded in case that shape changes.
  if (
    value &&
    typeof value === 'object' &&
    'range' in value &&
    'yMargin' in value &&
    typeof value.yMargin === 'number'
  ) {
    const { scrollTop } = view.scrollDOM;
    const viewportTop = view.scrollDOM.getBoundingClientRect().top;
    const { documentTop } = view;
    if (
      [scrollTop, viewportTop, documentTop].every((coordinate) =>
        Number.isFinite(coordinate),
      )
    ) {
      // Obsidian's properties sit above cm-content. Native snapshots choose an
      // anchor using scrollTop alone, which can point past the visible blocks.
      // Sample just inside the viewport to avoid a boundary between blocks.
      const anchor = view.lineBlockAtHeight(
        Math.max(0, viewportTop - documentTop + 8),
      );
      if (Number.isFinite(anchor.from) && Number.isFinite(anchor.top)) {
        const ratio = view.dom.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const pixelScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        value.range = EditorSelection.cursor(anchor.from);
        // Prevent fractional layout measurements accumulating across saves.
        value.yMargin =
          Math.round((anchor.top - scrollTop) * pixelScale) / pixelScale;
      }
    }
  }
};

/** Preserve the visible block without bringing an offscreen cursor into view. */
export const formattingScrollSnapshot = (view: EditorView) => {
  // Older Obsidian versions can still format without snapshot support.
  if (typeof view.scrollSnapshot !== 'function') return;

  // Measured reads can compensate scrolling after widget layout changes.
  // Flush that work before recording any of the snapshot's coordinates.
  view.lineBlockAtHeight(0);
  const snapshot = view.scrollSnapshot();
  correctSnapshotAnchor(view, snapshot.value);
  // eslint-disable-next-line consistent-return -- Snapshot support is optional in older editors.
  return snapshot;
};
