import { expect, test } from "@playwright/test";

test("只读文档双击标题或正文切换所属标题章节", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("一级标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("一级正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("二级标题");
  await editor.press("Control+Alt+2");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("二级正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("下一个一级标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("末尾正文");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  const firstHeading = editor.locator("h1").filter({ hasText: /^一级标题$/ });
  const nestedHeading = editor.locator("h2").filter({ hasText: /^二级标题$/ });
  const nextHeading = editor.locator("h1").filter({ hasText: /^下一个一级标题$/ });

  await firstHeading.dblclick();
  await expect(editor.getByText("一级正文", { exact: true })).toHaveClass(/heading-fold-hidden/);
  await expect(nestedHeading).toHaveClass(/heading-fold-hidden/);
  await expect(nextHeading).toBeVisible();

  await firstHeading.dblclick();
  await expect(editor.getByText("一级正文", { exact: true })).not.toHaveClass(/heading-fold-hidden/);
  await expect(nestedHeading).not.toHaveClass(/heading-fold-hidden/);

  await editor.getByText("二级正文", { exact: true }).dblclick();
  await expect(editor.getByText("二级正文", { exact: true })).toHaveClass(/heading-fold-hidden/);
  await expect(editor.getByText("一级正文", { exact: true })).toBeVisible();
  await expect(nestedHeading).toBeVisible();

  await nestedHeading.dblclick();
  await expect(editor.getByText("二级正文", { exact: true })).not.toHaveClass(/heading-fold-hidden/);
});

test("只读正文双击折叠后所属标题停留在双击位置附近", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const precedingBody = Array.from({ length: 24 }, (_, index) => `前置正文 ${index + 1}`).join("\n\n");
  const sectionBody = Array.from({ length: 36 }, (_, index) => `目标正文 ${index + 1}`).join("\n\n");
  const trailingBody = Array.from({ length: 36 }, (_, index) => `后续正文 ${index + 1}`).join("\n\n");
  await editor.click();
  await editor.evaluate((element, markdown) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", markdown);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, `# 前置章节\n\n${precedingBody}\n\n# 待折叠章节\n\n${sectionBody}\n\n# 后续章节\n\n${trailingBody}`);
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());

  const target = editor.getByText("目标正文 25", { exact: true });
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  const doubleClickY = targetBox!.y + targetBox!.height / 2;

  await target.dblclick();
  await expect(target).toHaveClass(/heading-fold-hidden/);
  const headingBox = await editor.getByText("待折叠章节", { exact: true }).boundingBox();
  expect(headingBox).not.toBeNull();
  const headingCenterY = headingBox!.y + headingBox!.height / 2;
  expect(Math.abs(headingCenterY - doubleClickY)).toBeLessThan(24);
});
