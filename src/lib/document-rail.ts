const chromeSelector = ".document-title-bar, .vr-title, .vr-actions, .document-toolbar, .markdown-source-toolbar-host, .editor-status-bar";
const startProperty = "--document-rail-start";
const endProperty = "--document-rail-end";
const widthProperty = "--document-rail-width";

/** Project the visible body edges onto chrome that can live outside its scrollport. */
export function observeDocumentRail(scope: HTMLElement, body: HTMLElement, sourceTitle?: HTMLElement | null): () => void {
  const measured = new Set<HTMLElement>();
  const source = body.classList.contains("cm-scroller");
  let items: HTMLElement[] = [];
  let chromeChanged = true;
  let frame = 0;
  const measure = () => {
    frame = 0;
    if (!body.clientWidth) return;
    const rect = body.getBoundingClientRect();
    let left = rect.left + (source ? body.clientLeft : 0);
    let right = source ? left + body.clientWidth : rect.right;
    // The split toolbar belongs to the whole source-and-preview surface.
    const split = source ? body.closest<HTMLElement>(".markdown-split-preview") : null;
    const preview = split?.querySelector<HTMLElement>(".markdown-preview-scroll");
    if (split && preview?.clientWidth) {
      const inset = parseFloat(getComputedStyle(split).getPropertyValue("--document-edge-inset")) || 0;
      left = split.getBoundingClientRect().left + inset;
      right = preview.getBoundingClientRect().left + preview.clientLeft + preview.clientWidth - inset;
    }
    if (chromeChanged) {
      items = Array.from(scope.querySelectorAll<HTMLElement>(chromeSelector));
      const title = sourceTitle?.querySelector<HTMLElement>(":scope > .local-file-titlebar");
      if (title && !items.includes(title)) items.push(title);
      for (const element of measured) if (!element.isConnected) measured.delete(element);
      chromeChanged = false;
    }
    for (const element of items) {
      if (!element.getClientRects().length || element.matches(".markdown-source-toolbar-host > *")) continue;
      const track = element.matches(".document-toolbar") ? element.parentElement! : element;
      const bounds = track.getBoundingClientRect();
      const contentOffset = track === element ? 0 : parseFloat(getComputedStyle(track).paddingLeft) || 0;
      const sizes = [left - bounds.left - track.clientLeft - contentOffset, bounds.right - right, right - left];
      [startProperty, endProperty, widthProperty].forEach((name, index) => {
        const value = `${Math.max(0, sizes[index])}px`;
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
      });
      if (!measured.has(element)) {
        element.dataset.documentRail = "";
        measured.add(element);
      }
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const resize = new ResizeObserver(schedule);
  resize.observe(body);
  resize.observe(scope);
  if (body.parentElement) resize.observe(body.parentElement);
  const structure = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches(`${chromeSelector}, .markdown-preview-pane`) || node.querySelector(chromeSelector))))) {
      chromeChanged = true;
      schedule();
    }
  });
  structure.observe(scope, { childList: true, subtree: true });
  const layout = new MutationObserver(schedule);
  layout.observe(scope, { attributes: true, attributeFilter: ["class", "style"] });
  if (sourceTitle && sourceTitle !== scope) {
    structure.observe(sourceTitle, { childList: true });
    resize.observe(sourceTitle);
  }
  measure();
  return () => {
    resize.disconnect();
    structure.disconnect();
    layout.disconnect();
    cancelAnimationFrame(frame);
    for (const element of measured) {
      delete element.dataset.documentRail;
      for (const name of [startProperty, endProperty, widthProperty]) element.style.removeProperty(name);
    }
  };
}
