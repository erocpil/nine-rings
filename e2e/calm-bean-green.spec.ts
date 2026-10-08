import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`清雅豆绿配色在 ${width} 宽度与深浅模式下保持一致`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() =>
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "calm",
          interface_color_mode: "light",
        }),
      ),
    );
    await page.goto("/");
    await expect(page.locator(".note-editor")).toBeVisible();
    const tokens = () =>
      page.locator("html").evaluate((element) => {
        const css = getComputedStyle(element);
        return Object.fromEntries(
          [
            "--bg",
            "--surface",
            "--text",
            "--accent",
            "--code-bg",
            "--syntax-keyword-color",
          ].map((token) => [token, css.getPropertyValue(token).trim()]),
        );
      });
    expect(await tokens()).toEqual({
      "--bg": "#dde8d8",
      "--surface": "#d2dfcd",
      "--text": "#29372c",
      "--accent": "#416849",
      "--code-bg": "#d4e1cf",
      "--syntax-keyword-color": "#7c5047",
    });
    await expect(page.locator(".note-editor-sticky")).toHaveCSS(
      "background-color",
      "rgb(221, 232, 216)",
    );
    await page.screenshot({
      path: testInfo.outputPath("calm-bean-green-light.png"),
    });
    await page.evaluate(() =>
      document.documentElement.classList.add("theme-dark"),
    );
    expect(await tokens()).toEqual({
      "--bg": "#202c23",
      "--surface": "#1b251e",
      "--text": "#e0e9db",
      "--accent": "#a6cea0",
      "--code-bg": "#26372b",
      "--syntax-keyword-color": "#dba095",
    });
    await expect(page.locator(".note-editor-sticky")).toHaveCSS(
      "background-color",
      "rgb(32, 44, 35)",
    );
    await page.screenshot({
      path: testInfo.outputPath("calm-bean-green-dark.png"),
    });
  });
}
