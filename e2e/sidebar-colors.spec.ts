import { expect, test } from "@playwright/test";

test("分栏导航和工具栏跟随主题背景，保留选中反馈", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  for (const theme of ["light", "dark", "fu", "grace", "sui", "zhi", "azure", "azure-dark"]) {
    await page.evaluate(async (name) => {
      // Exercise the real theme switch, including inherited CSS tokens.
      const { applyTheme } = await import("/src/lib/theme.ts");
      applyTheme(name);
    }, theme);
    for (const panel of ["文档树", "文档列表", "PDF / EPUB 阅读"]) {
      const rail = page.locator(".desktop-activity-bar");
      const button = rail.getByRole("button", { name: panel, exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
      const heading = page.locator(".app-sidebar .workspace-panel-heading").filter({ visible: true });
      await expect(heading).toBeVisible();
      const background = await page.locator("html").evaluate(el => getComputedStyle(el).backgroundColor);
      await expect(rail).toHaveCSS("background-color", background);
      await expect(heading).toHaveCSS("background-color", background);
      await expect(button).toHaveAttribute("aria-pressed", "true");
      expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    }
  }
});
