import { expect, test } from "@playwright/test";
const title = "物哀、幽玄与侘寂：风格设计与验证";
for (const [style, label, bg] of [
  ["mono-aware", "物哀", "rgb(250, 244, 243)"],
  ["yugen", "幽玄", "rgb(242, 245, 246)"],
  ["wabi-sabi", "侘寂", "rgb(244, 240, 230)"],
] as const) {
  test(`${label}内置样本、明暗配色及手机设置`, async ({ page }) => {
    await page.goto("/");
    const sample = page.getByRole("button", { name: title, exact: true });
    await expect(sample).toBeVisible();
    await sample.click();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await expect(
      page
        .locator(".editor-content")
        .getByText("物哀：阅读的节奏", { exact: true }),
    ).toBeVisible();
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page
      .getByRole("group", { name: "界面风格", exact: true })
      .getByRole("button", { name: new RegExp(label) })
      .click();
    const colors = page.getByRole("group", { name: "风格配色", exact: true });
    await colors.getByRole("button", { name: "浅色", exact: true }).click();
    await expect(page.locator("body")).toHaveCSS("background-color", bg);
    await colors.getByRole("button", { name: "深色", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("nine_rings_config") || "{}")
              .interface_color_mode,
        ),
      )
      .toBe("dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-style",
      style,
    );
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toHaveCount(1);
    await expect(page.locator(".editor-content h1").first()).toBeVisible();
    await expect(page.locator(".editor-content a").first()).toHaveCSS("color", style === "mono-aware" ? "rgb(219, 171, 192)" : style === "yugen" ? "rgb(160, 195, 213)" : "rgb(190, 199, 155)");
    await page.screenshot({ animations: "disabled", path: `/tmp/nr-${style}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const overlay = page.locator(".sidebar-overlay.active");
    if (await overlay.isVisible())
      await overlay.click({ position: { x: 380, y: 400 } });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ animations: "disabled", path: `/tmp/nr-${style}-mobile.png` });
  });
}
