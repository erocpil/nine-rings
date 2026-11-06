import { expect, test } from "@playwright/test";

test("取消路径及文档密码不显示错误或成功提示", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByTitle("显示属性面板", { exact: true }).click();
  const properties = page.locator(".properties-panel");
  for (const name of ["设置路径密码", "设置文档密码"]) {
    await properties.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(properties.getByRole("button", { name, exact: true })).toBeEnabled();
    await expect(page.locator(".error-bar")).toHaveCount(0);
    await expect(properties).not.toContainText("设置成功");
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator(".document-security-bar")).toHaveCount(0);
});
