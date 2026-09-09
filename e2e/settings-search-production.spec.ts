import { expect, test } from "@playwright/test";

test("生产 PWA 设置查找可定位现有更新按钮", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.keyboard.press("Alt+,");
  await page
    .getByRole("textbox", { name: "查找设置", exact: true })
    .fill("更新");
  await page.screenshot({ path: test.info().outputPath("settings-search.png") });
  await page.getByRole("button", { name: /检查更新.*设置首页/ }).click();
  await expect(page.locator(".settings-update-check")).toBeInViewport();
  await expect(page.locator(".settings-update-check")).toBeFocused();
});
