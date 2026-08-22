import { expect, test } from "@playwright/test";

test("PDF 打印视图展开正文并排除编辑器高亮与代码复制控件", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("导出标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("折叠后仍应导出的正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.press("Control+Alt+c");
  await editor.type("const exported = true;");

  const foldToggle = page.locator(".editor-heading-fold").first();
  await expect(foldToggle).toBeVisible();
  await foldToggle.click();
  await expect(page.locator(".heading-fold-hidden")).not.toHaveCount(0);

  const popupPromise = page.waitForEvent("popup");
  await page.getByTitle("导出 PDF（含目录）").click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");

  await expect(printPage.locator(".document-content")).toContainText("折叠后仍应导出的正文");
  await expect(printPage.locator(".document-content")).toContainText("const exported = true;");
  await expect(printPage.locator(".ProseMirror-activeline, .heading-fold-hidden, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);
});
