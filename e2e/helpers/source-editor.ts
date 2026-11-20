import { expect, type Locator } from "@playwright/test";
import { DOCUMENT_LANGUAGE_OPTIONS } from "../../src/lib/document-language";

export async function selectDocumentLanguage(page: import("@playwright/test").Page, language: string) {
  const picker = page.getByRole("combobox", { name: "文件格式", exact: true });
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(language);
    return;
  }
  const button = page.locator(".editor-status-bar").getByRole("button", { name: "文件格式", exact: true });
  if (await button.isVisible().catch(() => false) && await button.isEnabled()) {
    await button.click();
    const option = DOCUMENT_LANGUAGE_OPTIONS.find(option => option.value === language)!;
    await page.getByRole("menuitemcheckbox", { name: option.label, exact: true }).click();
    return;
  }
  await page.evaluate(async value => {
    const { runNativeMenuAction } = await import("/src/lib/native-menu-registry.ts");
    runNativeMenuAction(`format.language.${value || "text"}`);
  }, language);
}

async function prepare(area: Locator) {
  await area.evaluate((element) => {
    type View = import("@codemirror/view").EditorView;
    type EditorDOM = HTMLElement & { cmTile?: { root?: { view?: View } } };
    // Use the production editor's live instance, including its own extensions.
    // This is the same DOM attachment used by EditorView.findFromDOM.
    const content = (element.matches(".cm-content") ? element : element.querySelector(".cm-content")) as EditorDOM | null;
    const view = content?.cmTile?.root?.view;
    if (!view) throw new Error("Missing source editor view");
    (window as unknown as { sourceCM: { EditorView: typeof import("@codemirror/view").EditorView } }).sourceCM = {
      EditorView: view.constructor as typeof import("@codemirror/view").EditorView,
    };
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
