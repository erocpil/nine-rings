import { expect, test } from "@playwright/test";
import { openMobileSettings } from "./helpers/mobile-settings";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`同步设置布局 ${viewport.width}`, () => {
    const mobile = viewport.width !== 1280;
    test.use({ viewport, hasTouch: mobile });
    test("同步页返回分类后桌面保留弹层、手机恢复抽屉", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      if (mobile) await openMobileSettings(page);
      else await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.getByRole("button", { name: /^云端同步/ }).click();
      const panel = page.getByRole("dialog", { name: "云端同步", exact: true });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      if (mobile) {
        expect(box.x).toBeCloseTo(0, 0);
        expect(box.y).toBeCloseTo(0, 0);
        expect(box.width).toBeCloseTo(viewport.width, 0);
        expect(box.height).toBeCloseTo(viewport.height, 0);
      } else {
        expect(box.width).toBe(1080);
        expect(box.height).toBe(752);
        expect(box.x).toBe(100);
      }
      await panel.getByLabel("Owner / Repo", { exact: true }).fill("test/notes");
      await panel.getByLabel("Owner / Repo", { exact: true }).press("Tab");
      if (mobile) {
        await panel.evaluate(element => {
          element.setAttribute("data-navigation-animation", "");
          element.addEventListener("animationstart", event => {
            if (event.target === element) element.setAttribute("data-navigation-animation", (event as AnimationEvent).animationName);
          });
          const target = element.querySelector(".settings-header-main")!;
          const box = target.getBoundingClientRect();
          for (const [type, offset] of [["touchstart", 5], ["touchmove", 110], ["touchend", 110]] as const) {
            const touch = { identifier: 1, target, clientX: box.left + offset, clientY: box.top + 10 };
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
            target.dispatchEvent(event);
          }
        });
      } else await panel.getByRole("button", { name: "返回设置分类", exact: true }).click();
      const root = page.getByRole("dialog", { name: "设置", exact: true });
      if (mobile) {
        await expect(root).not.toHaveClass(/settings-expanded-panel/);
        // Observe animation events across frames; waiting only for stable geometry hides a replay.
        await root.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(root).toHaveAttribute("data-navigation-animation", "");
        await expect(root).toHaveCSS("transform", "none");
      }
      else expect(await root.boundingBox()).toEqual(box);
      await page.getByRole("button", { name: /^云端同步/ }).click();
      await expect(panel.getByLabel("Owner / Repo", { exact: true })).toHaveValue("test/notes");
      await page.getByRole("button", { name: "关闭设置", exact: true }).click();
      await expect(panel).toHaveCount(0);
    });
  });
}
