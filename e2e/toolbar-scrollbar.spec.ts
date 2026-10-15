import { expect, test } from "@playwright/test";
import { createBlankNote } from "./helpers/editor-fixtures";
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
test("工具栏可见滚动条中心可直接按住拖动", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await createBlankNote(page);
  const toolbar = page.locator(".editor-menu");
  await expect.poll(() => toolbar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(50);
  const track = await toolbar.evaluate(el => {
    el.scrollLeft = 0;
    const box = el.getBoundingClientRect();
    return { x: box.left + el.clientWidth * el.clientWidth / el.scrollWidth / 2,
      y: box.bottom - parseFloat(getComputedStyle(el).borderBottomWidth) - 3 };
  });
  await page.mouse.move(track.x, track.y);
  await expect(toolbar).toHaveAttribute("data-scrollbar-visible", "");
  await page.mouse.down();
  await page.mouse.move(track.x + 35, track.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => toolbar.evaluate(el => el.scrollLeft)).toBeGreaterThan(15);
  expect(await toolbar.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
});
