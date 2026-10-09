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
    for (const [name, target] of [["网址", url], ["文档", "../guide.md"], ["内部", internal]]) {
      await body.getByRole("link", { name, exact: true }).hover();
      await expect(page.getByRole("tooltip")).toHaveText(target);
      const bounds = (await page.getByRole("tooltip").boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1592);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(992);
    }
    const link = body.getByRole("link", { name: "网址", exact: true });
    await link.hover();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await body.locator(".nr-footnote-reference").hover();
    await expect(page.getByRole("tooltip")).toHaveText("脚注内容保持原样。");
    await body.locator("p").nth(1).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // Editable links belong to the contenteditable caret, not the tab order.
    if (mode === "edit") await link.hover();
    else await link.focus();
    await expect(page.getByRole("tooltip")).toHaveText(url);
    await body.evaluate(element => element.parentElement!.dispatchEvent(new Event("scroll")));
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // Touch pointer events on a wide desktop do not create previews either.
    await link.blur();
    await link.dispatchEvent("pointerover", { pointerType: "touch" });
    await expect(page.getByRole("tooltip")).toHaveCount(0);
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
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
