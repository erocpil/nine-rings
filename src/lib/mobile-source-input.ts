import { MOBILE_VIEWPORT_QUERY } from "../hooks/useEdgeDrawer";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { MobileInputSession } from "./mobile-input-session";

/** Source editing uses the same arbitration as the rendered editor, while
 * leaving native selection, focus and browser scroll ownership intact. */
export function mobileSourceInput() {
  const sessions = new WeakMap<EditorView, MobileInputSession>();
  return [
    ViewPlugin.define((view) => {
      const session = new MobileInputSession();
      sessions.set(view, session);
      const mobile = () =>
        matchMedia(MOBILE_VIEWPORT_QUERY).matches && !view.state.readOnly;
      let start: { x: number; y: number } | null = null;
      const down = (event: PointerEvent) => {
        if (!mobile() || event.pointerType === "mouse") return;
        start = { x: event.clientX, y: event.clientY };
        session.touch();
      };
      const move = (event: PointerEvent) => {
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
        )
          session.read();
      };
      const end = () => {
        start = null;
        session.release();
      };
      const input = (event: Event) =>
        session.input(
          view.composing || (event instanceof InputEvent && event.isComposing),
        );
      const compositionStart = () => session.input(true);
      const compositionEnd = () => session.input();
      const blur = () => session.blur();
      const navigate = () => session.navigate();
      const panelFocus = (event: FocusEvent) => {
        if (!view.contentDOM.contains(event.target as Node)) session.navigate();
      };
      view.contentDOM.addEventListener("pointerdown", down);
      view.contentDOM.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      view.contentDOM.addEventListener("beforeinput", input);
      view.contentDOM.addEventListener("keydown", input);
      view.contentDOM.addEventListener("compositionstart", compositionStart);
      view.contentDOM.addEventListener("compositionend", compositionEnd);
      view.contentDOM.addEventListener("blur", blur);
      view.contentDOM.addEventListener("nr:editor-navigation", navigate);
      view.dom.addEventListener("focusin", panelFocus);
      return {
        update(update) {
          if (
            !update.state.selection.main.empty &&
            session.phase !== "navigation"
          )
            session.select();
          else if (session.phase === "selection") session.phase = "idle";
        },
        destroy() {
          sessions.delete(view);
          view.contentDOM.removeEventListener("pointerdown", down);
          view.contentDOM.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          view.contentDOM.removeEventListener("beforeinput", input);
          view.contentDOM.removeEventListener("keydown", input);
          view.contentDOM.removeEventListener(
            "compositionstart",
            compositionStart,
          );
          view.contentDOM.removeEventListener("compositionend", compositionEnd);
          view.contentDOM.removeEventListener("blur", blur);
          view.contentDOM.removeEventListener("nr:editor-navigation", navigate);
          view.dom.removeEventListener("focusin", panelFocus);
        },
      };
    }),
    EditorView.scrollHandler.of((view) => {
      if (!matchMedia(MOBILE_VIEWPORT_QUERY).matches || view.state.readOnly)
        return false;
      return sessions.get(view)?.blocked ?? false;
    }),
  ];
}
