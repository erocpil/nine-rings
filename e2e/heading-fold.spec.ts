import { expect, test } from "@playwright/test";

test("标题章节可按层级折叠，并从目录统一展开", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 总览\n\n总览正文\n\n## 子节\n\n子节正文\n\n# 第二部分\n\n末尾正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.getByRole("button", { name: "折叠第 1 块章节" }).click();
  await expect(editor.getByText("总览正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();
  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await expect(outline.getByTitle("子节", { exact: true })).toHaveCount(0);
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByTitle("展开全部章节").click();
  await expect(editor.getByText("总览正文", { exact: true })).toBeVisible();
  await expect(editor.getByText("子节", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("子节", { exact: true })).toBeVisible();
  await outline.getByLabel("折叠章节 子节").click();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();

  await outline.getByTitle("折叠全部章节").click();
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByLabel("展开章节 总览").click();
  await expect(outline.getByLabel("展开章节 子节")).toBeVisible();

  // 同一帧内快速切换只触发一次 React 目录重绘，最终状态仍准确。
  await outline.evaluate((element) => {
    const collapse = element.querySelector<HTMLButtonElement>('button[title="折叠全部章节"]');
    const expand = element.querySelector<HTMLButtonElement>('button[title="展开全部章节"]');
    if (!collapse || !expand) throw new Error("fold controls missing");
    for (let index = 0; index < 12; index += 1) {
      collapse.click();
      expand.click();
    }
  });
  await expect(outline.locator(".document-outline-item")).toHaveCount(3);
  await expect(editor.getByText("子节正文", { exact: true })).toBeVisible();
});
