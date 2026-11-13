import { openWritableLocalDirectory } from "../helpers/local-files";
import { expect, test, type Page } from "@playwright/test";
import { closeDocumentSidebar } from "../helpers/workspace";
import { createBlankDocument } from "../helpers/document";

async function assertRails(page: Page, source: boolean) {
  const title = page.locator(source ? ".markdown-source-title-row:visible, .local-file-titlebar:visible" : ".note-editor-scroll:visible .note-title-row, .vr-note:visible .vr-title").first();
  await expect(title).toBeVisible();
  const measure = () => title.evaluate((element, source) => {
    const host = element.closest(source ? ".markdown-source-content" : ".note-editor")!;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const start = rect.left + parseFloat(style.paddingLeft), end = rect.right - parseFloat(style.paddingRight);
    const footer = host.querySelector<HTMLElement>(".editor-status-bar"), toolbar = host.querySelector<HTMLElement>(source ? ".markdown-source-tools" : ".editor-menu.toolbar-scrollable, .vr-actions");
    const visible = (node: HTMLElement | null) => node && node.getClientRects().length && getComputedStyle(node).display !== "none";
    const boundaries: Record<string, number> = {};
    if (visible(toolbar)) { const box = toolbar!.getBoundingClientRect(), css = getComputedStyle(toolbar!); boundaries.toolbarLeft = box.left + parseFloat(css.paddingLeft) - start; boundaries.toolbarRight = box.right - parseFloat(css.paddingRight) - end; }
    if (visible(footer)) { const box = footer!.getBoundingClientRect(), css = getComputedStyle(footer!, "::before"); boundaries.statusLeft = box.left + parseFloat(css.left) - start; boundaries.statusRight = box.right - parseFloat(css.right) - end; }
    const body = host.querySelector<HTMLElement>(source ? ".cm-scroller" : ".editor-content-shell, .vr-body");
    if (body) { const box = body.getBoundingClientRect(); boundaries.bodyLeft = box.left - start; boundaries.bodyRight = end - (source ? box.left + body.clientWidth - parseFloat(getComputedStyle(body).borderRightWidth || "0") : box.right); }
    return { start, end, boundaries };
  }, source);
  await expect.poll(async () => {
    const { boundaries } = await measure();
    return Math.max(...Object.entries(boundaries).filter(([key]) => !key.startsWith("body")).map(([, value]) => Math.abs(value)));
  }).toBeLessThan(1.1);
  const result = await measure();
  expect(Object.keys(result.boundaries)).toContain("statusLeft");
  expect(result.boundaries.bodyLeft).toBeGreaterThanOrEqual(-1);
  expect(result.boundaries.bodyRight).toBeGreaterThanOrEqual(-1);
  // Reading width can narrow the body, but never makes its outer inset asymmetric.
  expect(Math.abs(result.boundaries.bodyLeft - result.boundaries.bodyRight)).toBeLessThan(1.1);
  return result;
}

for (const width of [390, 1280]) for (const style of ["classic", "paper"]) {
  test(`标题、工具、正文和状态共享边界 ${width}/${style}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style, editor_show_status_bar: true, workspace_layout: "exhibition" })), style);
    await createBlankDocument(page, "布局边界");
    await closeDocumentSidebar(page);
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".ProseMirror:visible").fill("# Heading\n\n正文边界测试\n");
    const tools = page.getByRole("button", { name: "更多工具", exact: true });
    if (await tools.getAttribute("aria-expanded") !== "true") await tools.click();
    for (const focus of [false, true]) {
      if (focus) {
        await page.evaluate(async () => { const { runNativeMenuAction } = await import("/src/lib/native-menu-registry.ts"); await runNativeMenuAction("view.focus"); await runNativeMenuAction("document.source"); });
      }
      if (await tools.getAttribute("aria-expanded") !== "true") await tools.click();
      await assertRails(page, false);
      await page.evaluate(async () => { const { runNativeMenuAction } = await import("/src/lib/native-menu-registry.ts"); await runNativeMenuAction("document.readonly"); });
      await expect(page.locator(".ProseMirror:visible")).not.toHaveAttribute("contenteditable", "true");
      await assertRails(page, false);
      await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("document.source"));
      await expect(page.locator(".cm-content:visible")).toBeVisible();
      await assertRails(page, true);
      await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("document.readonly"));
      await expect(page.locator(".cm-content:visible")).toBeEditable();
      await assertRails(page, true);
    }

  });
}


for (const width of [390, 1280]) test(`局部只读与经典滚动条共享边界 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { localStorage.setItem("nr:experimentalReadonlyRendering", "true"); localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "paper", editor_show_status_bar: true })); });
  await createBlankDocument(page, "只读边界");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").fill("只读正文\n".repeat(100));
  await page.setViewportSize({ width, height: 900 });
  await page.addStyleTag({ content: ".note-editor-scroll::-webkit-scrollbar,.cm-scroller::-webkit-scrollbar {width:14px!important}" });
  await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("document.readonly"));
  await expect(page.locator("[data-virtual-reader=true]")).toBeVisible();
  await assertRails(page, false);
  await page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).runNativeMenuAction("document.source"));
  await expect(page.locator(".cm-content:visible")).toBeVisible();
  await assertRails(page, true);
});


for (const width of [390, 1280]) test(`本地Markdown复用相同边界 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createBlankDocument(page, "本地布局载体");
  const { workspace } = await openWritableLocalDirectory(page, { "layout.md": "# Heading\n\nLocal body\n" }, "layout.md");
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  await page.setViewportSize({ width, height: 900 });
  await expect(workspace.locator(".cm-content")).toBeVisible();
  await assertRails(page, true);
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(workspace.locator(".ProseMirror")).toBeVisible();
  await assertRails(page, false);
});
