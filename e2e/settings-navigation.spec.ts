import { expect, test } from "@playwright/test";

test("设置使用分类首页和二级页面精简内容", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();

  const categories = page.getByLabel("设置分类").getByRole("button");
  await expect(categories).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(0);
  await expect(page.locator(".settings-section")).toHaveCount(0);

  await page.getByRole("button", { name: /^编辑器/ }).click();
  await expect(page.getByRole("heading", { name: "编辑器", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(5);
  await expect(page.getByText("状态栏块号", { exact: true })).toBeVisible();
  await expect(page.getByText("Vim 模式（实验性）", { exact: true })).toBeVisible();
  await expect(page.getByText("主题", { exact: true })).toHaveCount(0);

  await page.getByLabel("返回设置分类").click();
  await expect(categories).toHaveCount(7);
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await expect(page.getByRole("heading", { name: "数据与导入", exact: true })).toBeVisible();
  await expect(page.getByText("数据导出 / 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("Markdown 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("快捷键", { exact: true })).toHaveCount(0);
});

test("设置弹窗具有语义并在键盘关闭后恢复焦点", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByTitle("设置");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("关闭设置")).toBeFocused();
  await expect.poll(() => page.locator(".settings-overlay").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).animationDuration),
  )).toBeLessThanOrEqual(0.00001);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
