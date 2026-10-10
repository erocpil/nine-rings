import { settingsBackdropFilter } from "./helpers/settings";
import { createBlankDocument } from "./helpers/document";
import { expect, test } from "@playwright/test";

test("设置卡片使用柔和主题底色且触摸悬停不变白", async ({ page }) => {
  await createBlankDocument(page, "设置主题与预览");
  await page.getByTitle("设置", { exact: true }).click();
  const card = page.locator(".settings-category-card").first();
  await expect(card).toBeVisible();
  const overlay = page.locator(".settings-overlay");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async theme => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { applyTheme } = await load("/src/lib/theme.ts") as typeof import("../src/lib/theme");
      applyTheme(theme);
    }, theme);
    await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(6px)");
    await expect.poll(() => card.evaluate(el => {
      const probe = document.createElement("span");
      probe.style.background = "var(--settings-card-bg)"; el.append(probe);
      const settled = getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
      probe.remove(); return settled;
    })).toBe(true);
    const colors = await card.evaluate(el => {
      const probe = document.createElement("span");
      probe.style.background = "var(--bg)";
      el.append(probe);
      const colors = { card: getComputedStyle(el).backgroundColor, plain: getComputedStyle(probe).backgroundColor };
      probe.remove();
      return colors;
    });
    expect(colors.card).not.toBe(colors.plain);
    await page.screenshot({ path: test.info().outputPath(`nr-settings-${theme}.png`), animations: "disabled" });
    await page.mouse.move(8, 500);
    await page.mouse.down();
    await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(0px)");
    await expect(overlay).toHaveCSS("opacity", "0");
    await page.screenshot({ path: test.info().outputPath(`nr-settings-peek-${theme}.png`), animations: "disabled" });
    await page.mouse.up();
    await expect(overlay).toHaveCSS("opacity", "1");
    await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(6px)");
  }
});
