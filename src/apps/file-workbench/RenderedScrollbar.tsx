import { useEffect, type RefObject } from "react";

/** Keep a native scroll track accessible when the document dock covers the
 * original scrollport edge. The document remains the only scroll authority. */
export function RenderedScrollbar({ root, active }: { root: RefObject<HTMLElement>; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let dispose: (() => void) | undefined;
    const connect = () => {
      if (dispose) return;
      const scroll = root.current?.querySelector<HTMLElement>(".workbench-rendered-session .note-editor-scroll");
      const owner = scroll?.closest<HTMLElement>(".note-editor");
      const body = scroll?.querySelector<HTMLElement>(".editor-content-shell");
      if (!scroll || !owner || !body) return;
      const track = document.createElement("div"), spacer = document.createElement("div");
      track.className = "workbench-render-scrollbar";
      track.setAttribute("aria-label", "文档垂直滚动条");
      track.append(spacer); owner.append(track);
      const fromDocument = () => { track.scrollTop = scroll.scrollTop; };
      const toDocument = () => { if (Math.abs(scroll.scrollTop - track.scrollTop) > 1) scroll.scrollTop = track.scrollTop; };
      const measure = () => {
        const box = scroll.getBoundingClientRect(), base = owner.getBoundingClientRect();
        const toolbar = scroll.querySelector<HTMLElement>(".note-editor-sticky");
        const top = Math.max(box.top, toolbar?.getBoundingClientRect().bottom ?? box.top);
        const dock = owner.querySelector<HTMLElement>(".document-panel-dock");
        const rightDock = dock && owner.classList.contains("document-panels-right") ? dock.getBoundingClientRect().width : 0;
        track.style.top = `${top - base.top}px`;
        track.style.height = `${Math.max(0, box.bottom - top)}px`;
        track.style.right = `${rightDock}px`;
        spacer.style.height = `${Math.max(0, box.bottom - top) + scroll.scrollHeight - scroll.clientHeight}px`;
        track.hidden = scroll.scrollHeight <= scroll.clientHeight + 1;
        fromDocument();
      };
      scroll.addEventListener("scroll", fromDocument, { passive: true });
      track.addEventListener("scroll", toDocument, { passive: true });
      const resize = new ResizeObserver(measure);
      resize.observe(scroll); resize.observe(body); resize.observe(owner);
      const mutation = new MutationObserver(measure);
      mutation.observe(owner, { attributes: true, attributeFilter: ["class", "style"] });
      const dock = owner.querySelector<HTMLElement>(".document-panel-dock");
      if (dock) resize.observe(dock);
      measure();
      dispose = () => { resize.disconnect(); mutation.disconnect(); scroll.removeEventListener("scroll", fromDocument); track.removeEventListener("scroll", toDocument); track.remove(); };
    };
    const mounted = new MutationObserver(connect);
    if (root.current) mounted.observe(root.current, { childList: true, subtree: true });
    connect();
    return () => { mounted.disconnect(); dispose?.(); };
  }, [active, root]);
  return null;
}
