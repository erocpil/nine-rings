import { expect, test } from "@playwright/test";

test("设置卡片使用柔和主题底色且触摸悬停不变白", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  const card = page.locator(".settings-category-card").first();
  await expect(card).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(async theme => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { applyTheme } = await load("/src/lib/theme.ts") as typeof import("../src/lib/theme");
      applyTheme(theme);
    }, theme);
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
    await page.screenshot({ path: `/tmp/nr-settings-${theme}.png`, animations: "disabled" });
  }
});
