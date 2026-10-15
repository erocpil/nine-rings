import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

const source = "中文解释：Reference Ladder 由**长期保留的基线层级（persistent tiers）**和**层级之间的有效归因关系（attribution structure）**构成。它的核心是相同条件下的 *feature isolation*，但并非所有层级天然可比；若添加功能的同时改变协议分布、IP 范围或报文长度，就产生了混杂变量（confounders）。";
const bold = ["长期保留的基线层级（persistent tiers）", "层级之间的有效归因关系（attribution structure）"];

for (const annotated of [false, true]) {
  test(`中文括号强调与斜体星号：${annotated ? "带样式的 Markdown 源码" : "纯文本"}粘贴、保存及预览`, async ({ page }) => {
    await createBlankDocument(page, "中文强调边界");
    const editor = page.locator(".ProseMirror:visible").first();
    await editor.click();
    await editor.evaluate((element, { source, annotated }) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", source);
      if (annotated) clipboardData.setData("text/html", "<p>" + source.replace("*feature isolation*", "<em>*feature isolation*</em>") + "</p>");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    }, { source, annotated });
    await expect(editor.locator("strong")).toHaveText(bold);
    await expect(editor.locator("em")).toHaveText("feature isolation");
    await expect(editor).not.toContainText("*");
    await waitForSavedText(page, "confounders");
    await page.reload();
    await expect(editor.locator("strong")).toHaveText(bold);
    await expect(editor.locator("em")).toHaveText("feature isolation");
    await expect(editor).not.toContainText("*");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.getByRole("button", { name: "并排预览", exact: true }).click();
    const preview = page.locator(".markdown-preview-scroll");
    await expect(preview.locator("strong")).toHaveText(bold);
    await expect(preview.locator("em")).toHaveText("feature isolation");
    await expect(preview).not.toContainText("*");
  });
}

test("普通富文本、内部切片和明确转义的星号不按源码改写", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(async () => {
    const { shouldParseClipboardMarkdown } = await import("/src/lib/clipboard-content.ts");
    return [
      shouldParseClipboardMarkdown("*feature isolation*", '<p data-pm-slice="0 0 []"><em>*feature isolation*</em></p>'),
      shouldParseClipboardMarkdown("feature isolation", "<p><em>feature isolation</em></p>"),
      shouldParseClipboardMarkdown("\\*feature isolation\\*", "<p>\\*feature isolation\\*</p>"),
    ];
  })).toEqual([false, false, false]);
});
