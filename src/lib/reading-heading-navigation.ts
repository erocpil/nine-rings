import type { Editor } from "@tiptap/core";
import { activeLinePluginKey } from "../extensions/EditorHighlights";
import {
  getCollapsedHeadingKeys,
  toggleHeadingSectionFold,
} from "../extensions/HeadingFold";
import {
  extractHeadingSections,
  headingSectionAtPosition,
  type HeadingSection,
} from "./heading-fold";
import { EDITOR_NAVIGATION_EVENT } from "./document-reading-restoration";

/** Resolve against the live model. WebView2 can lose coordinate hits after
 * backgrounding; title DOM positions and a final DOM fallback remain usable. */
export function readingHeadingAtPoint(
  editor: Editor,
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): HeadingSection | null {
  if (
    editor.isDestroyed ||
    !(target instanceof Node) ||
    !editor.view.dom.contains(target)
  )
    return null;
  const sections = extractHeadingSections(editor.state.doc);
  const element = target instanceof Element ? target : target.parentElement;
  const heading = element?.closest("h1,h2,h3,h4,h5,h6");
  const fromDOM = (node: Element) => {
    try {
      return headingSectionAtPosition(
        sections,
        editor.view.posAtDOM(node, 0, -1),
      );
    } catch {
      return null;
    } // A decoration refresh can detach the event target.
  };
  if (heading && editor.view.dom.contains(heading)) {
    const section = fromDOM(heading);
    if (section) return section;
  }
  const position = editor.view.posAtCoords({
    left: clientX,
    top: clientY,
  })?.pos;
  if (position !== undefined) {
    const section = headingSectionAtPosition(sections, position);
    if (section) return section;
  }
  return element && editor.view.dom.contains(element) ? fromDOM(element) : null;
}

/** Ordinary readonly heading fold, extracted from the database workspace.
 * It changes only reading state. Source ownership and persistence stay in the
 * host. Anchor synchronously before paint, never around a hidden old selection. */
export function toggleReadingHeading(
  editor: Editor,
  section: HeadingSection,
  root: HTMLElement | null,
  clientY: number,
  onActivate?: (position: number) => void,
): boolean {
  if (editor.isDestroyed || section.end <= section.headingEnd) return false;
  const heading = editor.view.nodeDOM(section.pos);
  root?.dispatchEvent(new Event(EDITOR_NAVIGATION_EVENT));
  const collapsing = !getCollapsedHeadingKeys(editor).has(section.key);
  let desiredTop: number | null = null;
  if (collapsing && heading instanceof HTMLElement && root) {
    const bounds = heading.getBoundingClientRect(),
      viewport = root.getBoundingClientRect();
    const requested =
      clientY >= bounds.top && clientY <= bounds.bottom
        ? bounds.top
        : clientY - bounds.height / 2;
    desiredTop = Math.min(
      viewport.bottom - bounds.height - 8,
      Math.max(viewport.top + 8, requested),
    );
  }
  window.getSelection()?.removeAllRanges();
  if (!toggleHeadingSectionFold(editor, section, false)) return false;
  editor.view.dispatch(
    editor.state.tr.setMeta(activeLinePluginKey, {
      readingBlockPosition: section.pos,
    }),
  );
  onActivate?.(section.pos);
  if (desiredTop !== null && root?.isConnected && !editor.isDestroyed) {
    const folded = editor.view.nodeDOM(section.pos);
    if (folded instanceof HTMLElement)
      root.scrollTop += folded.getBoundingClientRect().top - desiredTop;
  }
  return true;
}
