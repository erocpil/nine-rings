import { expect, test } from "@playwright/test";

test("PDF 打印视图用语义标题生成侧栏书签且不在正文插入目录", async ({ page }) => {
  await page.goto("/");
  const viewSwitch = page.locator(".sidebar-view-switch");
  if (await viewSwitch.getAttribute("data-target-view") === "tree") await viewSwitch.click();
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("书签大纲导出测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByTitle("显示属性面板").click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("导出标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("折叠后仍应导出的正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("子章节");
  await editor.press("Control+Alt+2");
  await editor.press("End");
  await editor.press("Enter");
  await editor.press("Control+Alt+c");
  await editor.type("const exported = true;");

  const foldToggle = page.locator(".editor-heading-fold").first();
  await expect(foldToggle).toBeVisible();
  await foldToggle.click();
  await expect(page.locator(".heading-fold-hidden")).not.toHaveCount(0);

  const popupPromise = page.waitForEvent("popup");
  await page.locator(".properties-panel").getByRole("button", { name: "导出 PDF（书签大纲）" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");

  await expect(printPage.locator(".document-content")).toContainText("折叠后仍应导出的正文");
  await expect(printPage.locator(".document-content")).toContainText("const exported = true;");
  await expect(printPage.locator(".ProseMirror-activeline, .heading-fold-hidden, .code-block-copy, [data-pdf-exclude]")).toHaveCount(0);
  await expect(printPage.locator(".toc, nav[aria-label='目录']")).toHaveCount(0);

  const outlineHeadings = printPage.locator(".print-document h1, .print-document h2");
  await expect(outlineHeadings).toHaveCount(3);
  await expect(outlineHeadings.nth(0)).toHaveAttribute("id", "document-title");
  await expect(outlineHeadings.nth(1)).toHaveAttribute("id", /\S+/);
  await expect(outlineHeadings.nth(2)).toHaveAttribute("id", /\S+/);

  const pdf = await printPage.pdf({ format: "A4", outline: true, tagged: true });
  expect(pdf.toString("latin1")).toContain("/Outlines");
});
