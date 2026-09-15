import { expect, test } from "@playwright/test";

for (const [width, height] of [[390, 800], [844, 390], [1280, 800]]) {
  test.describe(`加密状态工具栏 ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: width !== 1280 });
    test("顶部左对齐、专注隐藏、退出恢复且锁定前保存", async ({ page }) => {
      test.setTimeout(60000);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
        const { createDocumentKey, encryptDocument } = await load("/src/lib/document-crypto.ts") as typeof import("../src/lib/document-crypto");
        const note = await api.notes.create({
          title: "加密状态位置", date: "2026-09-10", storagePath: "tests/security",
          content: await encryptDocument({ ops: [{ insert: "加密正文\n" }] }, await createDocumentKey("password-123456")),
        });
        useNotesStore.getState().selectNote(note);
      });
      const unlock = async () => {
        await page.getByRole("button", { name: "输入密码打开" }).click();
        const dialog = page.getByRole("dialog", { name: "打开加密文档" });
        await dialog.getByLabel("密码", { exact: true }).fill("password-123456");
        await dialog.getByRole("button", { name: "验证密码" }).click();
        await expect(page.locator(".ProseMirror")).toBeVisible();
      };
      await unlock();
      if (width === 1280) {
        await page.keyboard.press("Control+Shift+f");
        const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
        await search.getByRole("textbox", { name: "全局搜索" }).fill("加密正文");
        await expect(search.locator(".search-results")).toContainText("搜索结果（0）");
        await search.getByRole("textbox", { name: "全局搜索" }).fill("加密状态位置");
        await expect(search.locator(".search-hit")).toContainText("加密状态位置");
        await expect(search.locator(".search-hit")).not.toContainText("加密正文");
        await search.getByRole("button", { name: "关闭全局搜索" }).click();
      }
      const status = page.locator(".note-title-row .note-security-action");
      await expect(status).toHaveAttribute("aria-label", "正文已加密，锁定文档");
      await expect(page.locator(".protected-editor > .document-security-bar")).toHaveCount(0);
      const bounds = await status.boundingBox();
      const header = await page.locator(".note-title-row").boundingBox();
      expect(bounds!.x - header!.x).toBeLessThan(20);
      expect(bounds!.y).toBeGreaterThanOrEqual(header!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(header!.y + header!.height);
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      await expect(page.getByText("正文已加密", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "锁定文档", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
      await expect(status).toBeVisible();
      await page.locator(".ProseMirror").fill("锁定前的改动");
      await status.click();
      await expect(page.locator(".ProseMirror")).toHaveCount(0);
      await expect(status).toHaveCount(0);
      await unlock();
      await expect(page.locator(".ProseMirror")).toContainText("锁定前的改动");
    });
  });
}
