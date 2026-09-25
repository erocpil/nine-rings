import { expect, type Locator } from "@playwright/test";
async function prepare(area: Locator) {
  await area.page().evaluate(async () => {
    (
      window as unknown as { sourceCM: typeof import("@codemirror/view") }
    ).sourceCM = await import("/node_modules/@codemirror/view/dist/index.js");
  });
}
export async function sourceInfo(area: Locator) {
  await prepare(area);
  for (let attempt = 0; ; attempt++) {
    try {
      return await area.evaluate((el) => {
        const { EditorView } = (
          window as unknown as { sourceCM: typeof import("@codemirror/view") }
        ).sourceCM;
        const view = EditorView.findFromDOM(el)!;
        if (!view.dom.isConnected) throw new Error("Detached source editor");
        const rect = view.scrollDOM.getBoundingClientRect();
        const offset =
          view.posAtCoords(
            {
              x: view.contentDOM.getBoundingClientRect().left + 12,
              y: rect.top + 2,
            },
            false,
          ) ?? view.viewport.from;
        return {
          value: view.state.doc.toString(),
          selectionStart: view.state.selection.main.from,
          selectionEnd: view.state.selection.main.to,
          scrollTop: view.scrollDOM.scrollTop,
          offset,
          readonly: view.state.readOnly,
        };
      });
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("Detached source editor"))
        throw error;
      await area
        .page()
        .evaluate(
          () => new Promise((resolve) => requestAnimationFrame(resolve)),
        );
    }
  }
}
export async function selectSource(area: Locator, from: number, to = from) {
  await prepare(area);
  await area.evaluate(
    async (el, range) => {
      const { EditorView } = (
        window as unknown as { sourceCM: typeof import("@codemirror/view") }
      ).sourceCM;
      const view = EditorView.findFromDOM(el)!;
      if (!view.dom.isConnected) throw new Error("Detached source editor");
      view.dispatch({
        selection: { anchor: range.from, head: range.to },
        scrollIntoView: true,
      });
      view.focus();
    },
    { from, to },
  );
}
export async function replaceSource(area: Locator, value: string) {
  await expect(area).toBeEditable();
  await prepare(area);
  await area.evaluate(async (el, value) => {
    const { EditorView } = (
      window as unknown as { sourceCM: typeof import("@codemirror/view") }
    ).sourceCM;
    const view = EditorView.findFromDOM(el)!;
    if (!view.dom.isConnected) throw new Error("Detached source editor");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    view.focus();
  }, value);
}
export async function scrollSourceTo(area: Locator, text: string) {
  await prepare(area);
  await area.evaluate(async (el, text) => {
    const { EditorView } = (
      window as unknown as { sourceCM: typeof import("@codemirror/view") }
    ).sourceCM;
    const view = EditorView.findFromDOM(el)!;
    if (!view.dom.isConnected) throw new Error("Detached source editor");
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const offset = view.state.doc.toString().indexOf(text);
    if (offset < 0) throw new Error("Missing source target");
    view.dispatch({
      effects: (view.constructor as typeof EditorView).scrollIntoView(offset, {
        y: "start",
        yMargin: 0,
      }),
    });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }, text);
}
