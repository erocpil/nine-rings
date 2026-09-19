import { expect, test } from "@playwright/test";
import { openMobileSettings } from "./helpers/mobile-settings";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`同步设置布局 ${viewport.width}`, () => {
    const mobile = viewport.width !== 1280;
    test.use({ viewport, hasTouch: mobile });
    test("同步页使用大面板或手机全屏，返回分类恢复抽屉", async ({ page }) => {
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
      await panel.getByRole("button", { name: "返回设置分类", exact: true }).click();
      const root = page.getByRole("dialog", { name: "设置", exact: true });
      await expect(root).not.toHaveClass(/settings-expanded-panel/);
      await page.getByRole("button", { name: /^云端同步/ }).click();
      await expect(panel.getByLabel("Owner / Repo", { exact: true })).toHaveValue("test/notes");
      await page.getByRole("button", { name: "关闭设置", exact: true }).click();
      await expect(panel).toHaveCount(0);
    });
  });
}
