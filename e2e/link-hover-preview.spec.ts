import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

const url = `https://example.com/中文?q=${"long-query-".repeat(32)}&mode=read`;
const internal = "nr-note://00000000-0000-0000-0000-000000000001";
const markdown = `[网址](${url}) · [文档](../guide.md) · [内部](${internal}) · 脚注[^1]\n\n` +
  "正文。\n\n".repeat(35) + "[^1]: 脚注内容保持原样。";

for (const mode of ["edit", "readonly", "virtual", "source"] as const) {
  test(`桌面链接气泡展示目标并与脚注共存：${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
    await createBlankDocument(page, "链接气泡");
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
    }, markdown);
    await waitForSavedText(page, "正文。");
    if (mode === "readonly" || mode === "virtual") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "source") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const preview = page.getByRole("button", { name: "并排预览", exact: true });
      if (await preview.getAttribute("aria-pressed") !== "true") await preview.click();
    }
    const body = page.locator(mode === "source" ? ".markdown-preview-scroll" : mode === "virtual" ? ".vr-body" : ".note-editor .editor-content");
    const linkPopup = () => page.getByRole(mode === "edit" ? "dialog" : "tooltip", mode === "edit" ? { name: "链接操作预览", exact: true } : {});
    for (const [name, target] of [["网址", url], ["文档", "../guide.md"], ["内部", internal]]) {
      await body.getByRole("link", { name, exact: true }).hover();
      await expect(linkPopup().locator(".nr-link-preview-address")).toHaveText(target);
      const bounds = (await linkPopup().boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1592);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(992);
    }
    const link = body.getByRole("link", { name: "网址", exact: true });
    await link.hover();
    await page.keyboard.press("Escape");
    await expect(page.locator(".nr-footnote-hover-preview")).toHaveCount(0);
    await body.locator(".nr-footnote-reference").hover();
    await expect(page.getByRole("tooltip")).toHaveText("脚注内容保持原样。");
    await body.locator("p").nth(1).hover();
    await expect(page.locator(".nr-footnote-hover-preview")).toHaveCount(0);
    // Editable links belong to the contenteditable caret, not the tab order.
    if (mode === "edit") await link.hover();
    else await link.focus();
    await expect(linkPopup().locator(".nr-link-preview-address")).toHaveText(url);
    await body.evaluate(element => element.parentElement!.dispatchEvent(new Event("scroll")));
    await expect(page.locator(".nr-footnote-hover-preview")).toHaveCount(0);
    // Touch pointer events on a wide desktop do not create previews either.
    await link.blur();
    await link.dispatchEvent("pointerover", { pointerType: "touch" });
    await expect(page.locator(".nr-footnote-hover-preview")).toHaveCount(0);
    expect(page.url()).not.toContain("example.com");
  });
}

test("手机悬停链接不显示桌面气泡", async ({ page }) => {
  await createBlankDocument(page, "手机链接");
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent('<p><a href="https://example.com">网址</a></p>', true);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  await page.getByRole("link", { name: "网址", exact: true }).hover();
  await expect(page.locator(".nr-footnote-hover-preview")).toHaveCount(0);
});

const localPackagePath = ".local-tools/plugin-packages/reading-display-20261018/erocpil.reading-display-1.0.0.nrplugin.zip";
for (const input of ["paste", "type"] as const) test(`引用中的本地插件路径不自动成为链接：${input}`, async ({page}) => {
  await createBlankDocument(page, "本地路径");
  const body = page.locator(".ProseMirror:visible");
  await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent("<blockquote><p></p></blockquote>", true);
    editor.commands.setTextSelection(2);
    editor.view.focus();
  });
  if (input === "paste") await body.evaluate((element, path) => {
    const data = new DataTransfer(); data.setData("text/plain", path);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, localPackagePath);
  else await page.keyboard.insertText(localPackagePath);
  await page.keyboard.press("Space");
  await expect(body.locator("blockquote")).toContainText(localPackagePath);
  await expect(body.locator("a")).toHaveCount(0);
  await page.keyboard.insertText("https://example.com/archive.zip");
  await page.keyboard.press("Space");
  await expect(body.getByRole("link", { name: "https://example.com/archive.zip", exact: true })).toHaveAttribute("href", "https://example.com/archive.zip");
});

for (const surface of ["hover", "context"] as const) test(`移除链接保留原文并可保存及撤销：${surface}`, async ({page}) => {
  await createBlankDocument(page, "移除链接");
  const body = page.locator(".ProseMirror:visible");
  await body.evaluate((element, path) => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent(`<blockquote><p>本地包 <a href="https://erocpil.reading-display-1.0.0.nrplugin.zip">${path}</a> 结束</p></blockquote>`, true);
  }, localPackagePath);
  await waitForSavedText(page, localPackagePath);
  const link = body.getByRole("link", { name: localPackagePath, exact: true });
  const originalSelection = await body.evaluate(element => { const selection = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.state.selection; return {from:selection.from,to:selection.to}; });
  if (surface === "hover") { const point = await link.evaluate(element => { const first = element.getClientRects()[0], box = element.getBoundingClientRect(); return {x:first.left-box.left+4,y:first.top-box.top+first.height/2}; }); await link.hover({position:point});; await page.getByRole("dialog", { name: "链接操作预览", exact: true }).getByRole("button", { name: "移除链接", exact: true }).click({timeout:5000}); }
  else { await link.click({button:"right"}); await page.getByRole("menu", {name:"链接操作", exact:true}).getByRole("menuitem", {name:"移除链接",exact:true}).click(); }
  await expect(link).toHaveCount(0);
  expect(await body.evaluate(element => { const selection = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.state.selection; return {from:selection.from,to:selection.to}; })).toEqual(originalSelection);
  await expect(body).toContainText(localPackagePath);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(link).toBeVisible();
  await link.click({button:"right"});
  await page.getByRole("menu", {name:"链接操作", exact:true}).getByRole("menuitem", {name:"移除链接",exact:true}).click();
  await expect.poll(() => page.evaluate(async () => {
    const {api} = await import("/src/lib/api.ts");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    return !!note && !JSON.stringify(note.content.ops).includes("https://erocpil.reading-display-1.0.0.nrplugin.zip");
  })).toBe(true);
  await page.reload();
  await expect(page.locator(".ProseMirror:visible")).toContainText(localPackagePath);
  await expect(page.locator(".ProseMirror:visible a")).toHaveCount(0);
  await page.getByRole("button", { name: "点击设为只读", exact:true }).click();
  // Read-only links have no modifying operation (the existing readonly fixture checks URL previews).
});
