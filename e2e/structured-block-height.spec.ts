import { expect, test } from "@playwright/test";
import { createBlankNote } from "./helpers/editor-fixtures";

for (const width of [1280, 390]) test(`长引用和代码正文限制高度 ${width}`, async ({ page }) => {
  const editor = await createBlankNote(page);
  await editor.evaluate(element => {
    const ed = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    ed.commands.setContent({ type: "doc", content: [
      { type: "blockquote", content: Array.from({ length: 40 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `引用第${i}行` }] })) },
      { type: "codeBlock", content: [{ type: "text", text: Array.from({ length: 60 }, (_, i) => `code ${i}`).join("\n") }] },
    ] });
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.setViewportSize({ width, height: 800 });
  for (const selector of [".blockquote-content", ".code-block-inner"]) {
    const body = editor.locator(selector).first();
    await expect.poll(() => body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await body.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(400);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  }
});

test("代码选区复制到引用保留换行", async ({ page }) => {
  const editor = await createBlankNote(page);
  const result = await editor.evaluate(element => {
    const ed = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    const text = "first\n    second\n\nlast";
    ed.commands.setContent({ type: "doc", content: [
      { type: "codeBlock", content: [{ type: "text", text }] },
      { type: "blockquote", content: [{ type: "paragraph" }] },
    ] });
    ed.commands.setTextSelection({ from: 1, to: 1 + text.length });
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    ed.commands.setTextSelection(text.length + 4);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    return { html: data.getData("text/html"), quote: ed.state.doc.lastChild?.toJSON() };
  });
  expect(result.html).toContain("<br");
  expect(result.quote.content[0].content.filter((node: { type: string }) => node.type === "hardBreak")).toHaveLength(3);
});
