import { settingsBackdropFilter } from "./helpers/settings";
import { expect, test } from "@playwright/test";
import { openMobileSettings } from "./helpers/mobile-settings";

test.describe("手机设置抽屉方向", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`右下角左划从右侧打开，旋转后仍靠右 ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      // Freeze halfway through entry to verify actual movement, not just its name.
      const animation = await page.addStyleTag({ content: ".settings-panel { animation-duration: 1s !important; animation-delay: -.5s !important; animation-timing-function: linear !important; animation-play-state: paused !important; }" });
      await openMobileSettings(page);
      const panel = page.getByRole("dialog", { name: "设置", exact: true });
      await expect.poll(() => settingsBackdropFilter(page.locator(".settings-overlay"))).toBe("none");
      expect(await panel.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBeGreaterThan(0);
      await animation.evaluate(el => el.remove());
      const rightGap = () => panel.evaluate(el => Math.abs(innerWidth - el.getBoundingClientRect().right));
      await expect.poll(rightGap).toBeLessThan(1);
      expect((await panel.boundingBox())!.x).toBeGreaterThan(0);

      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await expect.poll(rightGap).toBeLessThan(1);
      await expect(panel).toHaveCSS("border-left-width", "1px");
      await expect(panel).toHaveCSS("border-right-width", "0px");

      // Rightward swipe dismisses the right-hand drawer; it must not open a left sidebar.
      await panel.locator(".settings-header-main").evaluate(el => {
        const box = el.getBoundingClientRect();
        for (const [type, offset] of [["touchstart", 5], ["touchmove", 110], ["touchend", 110]] as const) {
          const touch = { identifier: 1, target: el, clientX: box.left + offset, clientY: box.top + 10 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
          el.dispatchEvent(event);
        }
      });
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "文档侧栏", exact: true })).toBeHidden();
      await openMobileSettings(page);
      await page.getByRole("button", { name: "关闭设置", exact: true }).click();
      await expect(panel).toHaveCount(0);
    });
  }
});

test("桌面设置首页与子页使用相同居中弹层", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(panel).toHaveCSS("animation-name", "fadeIn");
  const box = (await panel.boundingBox())!;
  expect(box).toEqual({ x: 100, y: 24, width: 1080, height: 752 });
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const subpage = page.getByRole("dialog", { name: "外观与布局", exact: true });
  expect(await subpage.boundingBox()).toEqual(box);
  await page.getByLabel("返回设置分类").click();
  expect(await panel.boundingBox()).toEqual(box);
  await page.mouse.click(20, 20);
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(panel).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`设置分类与子页切换从顶部显示 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 380 });
    await page.goto("/");
    await expect(page.locator(".note-editor")).toBeVisible();
    if (width === 390) await openMobileSettings(page);
    else await page.getByRole("button", { name: "设置", exact: true }).click();
    const root = page.locator('.settings-body[data-settings-page="root"]');
    await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => root.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    const appearance = page.locator('.settings-body[data-settings-page="appearance"]');
    await expect.poll(() => appearance.evaluate(element => element.scrollTop)).toBe(0);
    await appearance.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => appearance.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole("button", { name: /^层次展示/ }).click();
    const hierarchy = page.locator('.settings-body[data-settings-page="hierarchy"]');
    await expect.poll(() => hierarchy.evaluate(element => element.scrollTop)).toBe(0);
    await page.getByLabel("返回外观与布局").click();
    await expect.poll(() => appearance.evaluate(element => element.scrollTop)).toBe(0);
  });
}
