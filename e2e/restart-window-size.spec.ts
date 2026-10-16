import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const scenario of ["editable", "readonly", "image", "geometry"]) test(`最大化退出后以普通窗口恢复阅读位置 ${scenario}`, async ({ page, context }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await createBlankDocument(page, "窗口尺寸重启恢复");
  const editor = page.locator(".note-editor:visible .tiptap.ProseMirror").first();
  await editor.fill(Array.from({ length: 65 }, (_, i) => `第${i}段 ${"中文 mixed text keeps wrapping across window widths. ".repeat(18)}`).join("\n"));
  await waitForSavedText(page, "第64段");
  if (scenario === "image") {
    await editor.evaluate(element => {
      const ed = (element as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
      const content = ed.getJSON().content!;
      content.splice(40, 0, { type: "resizableImage", attrs: { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", width: 500, alt: "位置测试" } });
      ed.commands.setContent({type: "doc", content}, true);
    });
    await expect.poll(() => page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
      return JSON.stringify(note?.content);
    })).toContain("R0lGODlh");
  }
  if (scenario !== "editable") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await editor.locator(":scope > p").nth(40).evaluate(el => el.scrollIntoView({block:"start"}));
  if (scenario === "image") await editor.locator("img").evaluate(el => {
    const root = el.closest(".note-editor-scroll")!;
    const sticky = root.querySelector(":scope > .note-editor-sticky")!;
    root.scrollTop += el.getBoundingClientRect().top - sticky.getBoundingClientRect().bottom + 100;
  });
  if (scenario === "geometry") await editor.evaluate(element => {
    const ed = (element as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
    ed.view.posAtCoords = () => null;
  });
  // Flush the same persistence boundary used by native shutdown.
  const saved = await page.evaluate(async () => {
    const { READING_POSITION_FLUSH_EVENT, readReadingState } = await import("/src/lib/reading-state.ts");
    window.dispatchEvent(new Event(READING_POSITION_FLUSH_EVENT));
    const id = localStorage.getItem("nr:lastNote")!;
    return { id, state: readReadingState(id) };
  });
  expect(saved.state.rendered?.anchor).toBeTruthy();
  await page.close();
  const next = await context.newPage();
  await next.setViewportSize({ width: 1100, height: 760 });
  await next.goto("/");
  const restored = next.locator(".note-editor:visible .note-editor-scroll");
  await expect(restored).toBeVisible();
  const delta = () => next.locator(".note-editor:visible .tiptap.ProseMirror").first().evaluate((el, anchor) => {
    const ed = (el as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
    const root = el.closest(".note-editor-scroll")!;
    const sticky = root.querySelector(":scope > .note-editor-sticky");
    const top = sticky ? sticky.getBoundingClientRect().bottom : root.getBoundingClientRect().top;
    const node = ed.view.nodeDOM(anchor.position);
    const y = anchor.kind === "block" && node instanceof HTMLElement ? node.getBoundingClientRect().top : ed.view.coordsAtPos(anchor.position).top;
    return y - top - anchor.offset;
  }, saved.state.rendered!.anchor!);
  await expect.poll(delta).toBeLessThan(3);
  await expect.poll(delta).toBeGreaterThan(-3);
  // Check after the startup layout observers and persistence debounce settle.
  await next.waitForTimeout(1200);
  expect(Math.abs(await delta())).toBeLessThan(3);
  await next.close();
});
