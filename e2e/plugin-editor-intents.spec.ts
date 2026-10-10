import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { selectSource, sourceInfo } from "./helpers/source-editor";

test("宿主命令通过真实渲染/源码会话编辑，保留格式、保存修订和单步撤销", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const { DocumentEditSessions } = await import("/src/lib/document-edit-sessions.ts");
    const select = DocumentEditSessions.prototype.select;
    DocumentEditSessions.prototype.select = function (...args) {
      select.apply(this, args);
      Object.assign(window, { intentSessions: this });
    };
  });
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate(el => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.commands.insertContent("base");
    ed.commands.setTextSelection(1);
  });
  await page.evaluate(async () => {
    const { pluginRuntime, setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { HostCommandDispatcher } = await import("/src/lib/plugin-system/command-dispatcher.ts");
    setPluginsEnabled(true);
    const activation = pluginRuntime.activate("test.editor", ["editor.selection.read", "editor.selection.write", "documents.current.read"]);
    const host = window as any;
    const dispatcher = new HostCommandDispatcher(pluginRuntime, host.intentSessions, () => ({
      platform: "web", view: document.querySelector(".cm-editor") ? "source" : "render",
      documentId: localStorage.getItem("nr:lastNote")!,
    }));
    dispatcher.register(activation, { id: "test.editor.text", scope: "selection", risk: "write" }, ctx => ctx.commit({ type: "text", value: "**literal**" }));
    dispatcher.register(activation, { id: "test.editor.markdown", scope: "selection", risk: "write" }, ctx => ctx.commit({ type: "markdown", value: "**formatted**" }));
    Object.assign(window, { intentDispatcher: dispatcher, intentActivation: activation });
  });
  const execute = (commandId: string, requestId: string) => page.evaluate(async request => {
    const host = window as any;
    return host.intentDispatcher.execute(host.intentActivation, request);
  }, { commandId, requestId });
  expect(await execute("test.editor.text", "render-text")).toMatchObject({ ok: true, applied: true });
  await expect(editor).toHaveText("**literal**base");
  await expect(editor.locator("strong")).toHaveCount(0);
  await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.undo());
  await expect(editor).toHaveText("base");
  expect(await execute("test.editor.markdown", "render-markdown")).toMatchObject({ ok: true, applied: true });
  await expect(editor.locator("strong")).toHaveText("formatted");
  await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.undo());
  await expect(editor).toHaveText("base");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toBeEditable();
  await selectSource(source, 0);
  const before = (await sourceInfo(source)).value;
  expect(await execute("test.editor.text", "source-text")).toMatchObject({ ok: true, applied: true });
  expect((await sourceInfo(source)).value).toBe("**literal**" + before);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await sourceInfo(source)).value).toBe(before);
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(false);
  });
  expect(await execute("test.editor.text", "disabled")).toMatchObject({ ok: false, applied: false, error: { code: "PLUGIN_DISABLED" } });
  expect((await sourceInfo(source)).value).toBe(before);
});
