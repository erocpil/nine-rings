import { test, expect } from "@playwright/test";

test.describe("编辑器复制粘贴", () => {
  test("复制行内文本后粘贴不会引入首尾空白", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("前缀 中间文本 后缀");

    await editor.evaluate((element) => {
      const text = element.querySelector("p")?.firstChild;
      if (!text) throw new Error("editor text node not found");
      const value = text.textContent ?? "";
      const start = value.indexOf("中间文本");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "中间文本".length);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+C");

    await editor.evaluate((element) => {
      const text = element.querySelector("p")?.firstChild;
      if (!text) throw new Error("editor text node not found");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.textContent?.length ?? 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+V");

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("前缀 中间文本 后缀中间文本");
  });

  test("复制整行文本后粘贴只产生预期内容", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("整行文本");
    await editor.press("Control+A");
    await page.keyboard.press("Control+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("整行文本");
    await editor.evaluate((element) => {
      const paragraph = element.querySelector("p");
      const text = paragraph?.firstChild;
      if (!paragraph || !text) throw new Error("editor text node not found");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.textContent?.length ?? 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+V");

    await expect(editor).toHaveText("整行文本整行文本");
    await expect(editor.locator("p")).toHaveCount(1);
  });

  test("通过编辑器粘贴按钮粘贴单段 HTML 不产生首尾空段落", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("前缀 后缀");
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob(["<p>中间文本</p>"], { type: "text/html" }),
          "text/plain": new Blob(["中间文本"], { type: "text/plain" }),
        }),
      ]);
    });
    await editor.click();
    await page.keyboard.press("End");
    await page.getByTitle("粘贴 (Ctrl+V)").click();

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("前缀 后缀中间文本");
  });
});
