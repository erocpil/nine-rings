import { expect, test } from "@playwright/test";

for (const theme of [
  { id: "nord", name: "Nord · 北境", background: "rgb(46, 52, 64)" },
  { id: "dracula", name: "Dracula · 德古拉", background: "rgb(40, 42, 54)" },
]) {
  test(`${theme.id} 主题切换、重载保留及恢复浅色`, async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page.getByTitle(theme.name, { exact: true }).click();
    await expect(page.getByTitle(theme.name, { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveCSS("background-color", theme.background);
    await expect(page.locator(".settings-toast")).toHaveText("已更新");

    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(`theme-${theme.id}`));
    await expect(page.locator("body")).toHaveCSS("background-color", theme.background);
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await expect(page.getByTitle(theme.name, { exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByTitle("浅色", { exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(new RegExp(`theme-${theme.id}`));
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  });
}
