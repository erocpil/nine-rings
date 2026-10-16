import { expect, test } from "@playwright/test";

for (const style of [
  "classic",
  "calm",
  "paper",
  "minimal",
  "nine-rings",
  "mono-aware",
  "yugen",
  "wabi-sabi",
]) {
  test(`${style} 文档树浅色表面遵循主题`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (style) =>
        localStorage.setItem(
          "nine_rings_config",
          JSON.stringify({
            interface_style: style,
            theme: "light",
            interface_color_mode: "light",
            workspace_layout: "standard",
          }),
        ),
      style,
    );
    await page.goto("/");
    await expect(page.locator(".doc-tree").first()).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    const surface = await page.locator(".app-sidebar").evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--bg)";
      el.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: style.backgroundColor, expected };
    });
    expect(surface.actual).toBe(surface.expected);
    expect(surface.actual).not.toBe("rgba(0, 0, 0, 0)");
    // Pinning and hover presentation must not select different theme surfaces.
    await page.evaluate(async () => {
      const path = "/src/hooks/useSidebarPresentation.ts";
      const { saveSidebarPresentation } = await import(/* @vite-ignore */ path);
      saveSidebarPresentation("overlay");
    });
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
    await page.locator('[data-sidebar-panel="tree"]').hover();
    await expect(page.locator(".app-sidebar")).not.toHaveClass(
      /sidebar-hidden/,
    );
    await expect(page.locator(".app-sidebar")).toHaveCSS(
      "background-color",
      surface.expected,
    );
    await page.locator('[data-sidebar-panel="tree"]').click();
    await expect(page.locator('[data-sidebar-panel="tree"]')).toHaveAttribute(
      "data-pinned",
      "true",
    );
    await expect(page.locator(".app-sidebar")).toHaveCSS(
      "background-color",
      surface.expected,
    );
    // User navigation colours still override the default in both presentations.
    await page
      .locator(".app-sidebar")
      .evaluate((el) =>
        (el as HTMLElement).style.setProperty(
          "--navigation-tree-bg",
          "#456789",
        ),
      );
    await expect(page.locator(".app-sidebar")).toHaveCSS(
      "background-color",
      "rgb(69, 103, 137)",
    );
  });
}
