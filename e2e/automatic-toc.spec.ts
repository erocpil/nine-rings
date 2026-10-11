import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const key of ["Enter", "Space"]) {
  test(`/toc 用 ${key} 插入自动目录，级别、重命名、撤销和重载保持`, async ({ page }) => {
    await createBlankDocument(page, "自动目录");
    const editor = page.locator(".ProseMirror:visible");
    await editor.click();
    await page.keyboard.type("/toc");
    await page.keyboard.press(key);
    const toc = page.getByRole("navigation", { name: "文档内目录" });
    await expect(toc).toBeVisible();
    await editor.evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.insertContent('<h1>开始</h1><h2>章节</h2><h6>末级标题</h6><p>正文</p>');
    });
    await expect(toc.getByRole("link")).toHaveCount(2);
    await toc.getByRole("checkbox", { name: "目录展示 H6", exact: true }).check();
    await expect(toc.getByRole("link", { name: "末级标题", exact: true })).toBeVisible();
    await editor.evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      let position = 0;
      editor.state.doc.forEach((node, pos) => { if (node.textContent === "章节") position = pos; });
      editor.view.dispatch(editor.state.tr.insertText("更新章节", position + 1, position + 3));
    });
    await expect(toc.getByRole("link", { name: "更新章节", exact: true })).toBeVisible();
    await editor.evaluate(element => (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.undo());
    await expect(toc.getByRole("link", { name: "章节", exact: true })).toBeVisible();
    await waitForSavedText(page, "末级标题");
    await page.reload();
    await expect(toc.getByRole("link")).toHaveCount(3);
    await expect(toc.getByRole("checkbox", { name: "目录展示 H6", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("levels: 1,2,3,6");
  });
}

for (const mode of ["edit", "readonly", "virtual", "source"] as const) {
  test(`普通 Markdown 目录与自动目录跳转，重复标题和超长标题：${mode}`, async ({ page }) => {
    await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
    await createBlankDocument(page, "目录跳转");
    const long = "超长标题内容".repeat(150);
    const markdown = '[跳到最后](#3-网卡接收rx-ring-与-dma)\n\n```toc\nlevels: 1,2,3\n```\n\n## 重复\n\n' + '正文。\n\n'.repeat(35) + `## ${long}\n\n` + '正文。\n\n'.repeat(35) + '## 重复\n\n## 3. 网卡接收、RX ring 与 DMA\n\n末尾正文';
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
      editor.commands.setTextSelection(1);
    }, markdown);
    await waitForSavedText(page, "末尾正文");
    if (mode === "readonly" || mode === "virtual") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "source") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const button = page.getByRole("button", { name: "并排预览", exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    }
    const body = page.locator(mode === "source" ? ".markdown-preview-scroll:visible" : mode === "virtual" ? ".vr-body:visible" : ".note-editor:visible .editor-content").first();
    await (mode === "source" ? body : page.locator(".note-editor-scroll:visible")).evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    const toc = body.getByRole("navigation", { name: "文档内目录" });
    await expect(toc.getByRole("link")).toHaveCount(4);
    const duplicates = toc.getByRole("link", { name: "重复", exact: true });
    await expect(duplicates).toHaveCount(2);
    expect(await duplicates.nth(0).getAttribute("href")).not.toBe(await duplicates.nth(1).getAttribute("href"));
    const longLabel = toc.getByRole("link").nth(1);
    expect([...await longLabel.innerText()].length).toBeLessThanOrEqual(81);
    await expect(longLabel).toContainText("…");
    await body.getByRole("link", { name: "跳到最后", exact: true }).click();
    await expect(body.locator("h2").filter({ hasText: "3. 网卡接收、RX ring 与 DMA" })).toBeInViewport();
    expect(new URL(page.url()).hash).toBe("");
    // Back at the top, the dynamic TOC uses the same heading navigation path.
    await (mode === "source" ? body : page.locator(".note-editor-scroll:visible")).evaluate(element => { element.scrollTop = 0; });
    await toc.getByRole("link", { name: "3. 网卡接收、RX ring 与 DMA", exact: true }).click();
    await expect(body.locator("h2").filter({ hasText: "3. 网卡接收、RX ring 与 DMA" })).toBeInViewport();
  });
}

test("手机自动目录级别可点选，超长标签不撑宽竖屏或横屏", async ({ page }, testInfo) => {
  await createBlankDocument(page, "手机目录");
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      { type: "codeBlock", attrs: { language: "toc" }, content: [{ type: "text", text: "levels: 1,2,3" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "过长标题".repeat(100) }] },
      { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "末级标题" }] },
    ] }, true);
  });
  const toc = page.getByRole("navigation", { name: "文档内目录" });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const backdrop = page.locator(".sidebar-overlay.active");
    if (await backdrop.isVisible()) {
      await backdrop.click({ position: { x: viewport.width - 2, y: 100 } });
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("opacity", "0");
    }
    await expect(toc).toBeVisible();
    await expect(toc.locator("ol")).toHaveCSS("list-style-type", "none");
    // WebKit serializes an absent pseudo-element as an empty string.
    expect(["none", "", "normal"]).toContain(await toc.locator("li").first().evaluate(element => getComputedStyle(element, "::before").content));
    const bounds = (await toc.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await toc.getByRole("checkbox", { name: "目录展示 H6", exact: true }).check();
    await expect(toc.getByRole("link", { name: "末级标题", exact: true })).toBeVisible();
    await expect.poll(() => toc.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`toc-mobile-${viewport.width}.png`) });
  }
});
