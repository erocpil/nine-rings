import { expect, test } from "@playwright/test";

test("风格预览跟随深浅配色，桌面四列，旧紧凑配置仍可识别", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        interface_style: "calm-compact",
        interface_color_mode: "light",
        workspace_layout: "exhibition",
      }),
    ),
  );
  await page.goto("/");
  await expect(page.getByLabel("工作区风格")).toHaveValue("calm");
  await expect(page.getByLabel("紧凑程度")).toHaveValue("compact");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const styles = page.getByRole("group", { name: "界面风格", exact: true });
  await expect(styles.getByRole("button")).toHaveCount(8);
  await expect(styles.locator(".interface-style-option > strong")).toHaveText(["经典", "清雅", "纸页", "精简", "九环", "物哀", "幽玄", "侘寂"]);
  await expect(styles.getByRole("button", { name: /^清雅 / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(styles.getByRole("button", { name: /清雅·紧凑/ })).toHaveCount(
    0,
  );
  const grid = page.locator(".interface-style-options");
  await expect
    .poll(() =>
      grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(4);
  const palettes = [
    ["calm", "rgb(252, 251, 248)", "rgb(37, 42, 36)"],
    ["paper", "rgb(250, 246, 237)", "rgb(40, 36, 31)"],
    ["minimal", "rgb(250, 250, 250)", "rgb(32, 34, 38)"],
    ["nine-rings", "rgb(250, 247, 255)", "rgb(33, 23, 47)"],
    ["mono-aware", "rgb(250, 244, 243)", "rgb(41, 35, 39)"],
    ["yugen", "rgb(242, 245, 246)", "rgb(24, 35, 47)"],
    ["wabi-sabi", "rgb(244, 240, 230)", "rgb(40, 40, 32)"],
  ];
  for (const [style, light] of palettes)
    await expect(page.locator(`.preview-${style}`)).toHaveCSS(
      "background-color",
      light,
    );
  const colors = page.getByRole("group", { name: "风格配色", exact: true });
  await colors.getByRole("button", { name: "深色", exact: true }).click();
  for (const [style, , dark] of palettes)
    await expect(page.locator(`.preview-${style}`)).toHaveCSS(
      "background-color",
      dark,
    );
  await page.screenshot({ path: "/tmp/nr-style-previews-dark.png" });
  await colors.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  for (const [style, light] of palettes)
    await expect(page.locator(`.preview-${style}`)).toHaveCSS(
      "background-color",
      light,
    );
  await page.emulateMedia({ colorScheme: "dark" });
  for (const [style, , dark] of palettes)
    await expect(page.locator(`.preview-${style}`)).toHaveCSS(
      "background-color",
      dark,
    );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(1);
  await expect(page.locator(".preview-paper")).toHaveCSS(
    "background-color",
    "rgb(40, 36, 31)",
  );
});
