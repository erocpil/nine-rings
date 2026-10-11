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
      await expect(heading).toHaveCSS("background-color", panel === "文档树" ? "rgba(0, 0, 0, 0)" : background);
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const icon = button.locator(".toolbar-icon");
      await expect(icon).toHaveCSS("stroke-width", "2.4px");
      const accent = await rail.evaluate(el => getComputedStyle(el).getPropertyValue("--accent").trim());
      await expect.poll(() => icon.evaluate((el, value) => {
        const sample = document.createElement("span");
        sample.style.color = value; el.appendChild(sample);
        const expected = getComputedStyle(sample).color; sample.remove();
        return getComputedStyle(el).color === expected;
      }, accent)).toBe(true);
    }
  }
});
