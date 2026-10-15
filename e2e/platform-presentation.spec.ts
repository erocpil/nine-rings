import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`共享文档界面无时钟和密码栏，完整/局部阅读工具语义一致 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({ title: "跨端工具验证", date: useNotesStore.getState().currentDate,
        storagePath: "references/platform-presentation",
        content: { ops: [{ insert: "标题" }, { insert: "\n", attributes: { header: 1 } }, { insert: "正文\n" }],
          metadata: { bookmarks: [{ id: "test-bookmark", position: 1, preview: "标题", createdAt: new Date().toISOString() }] } },
      });
      await api.notes.update(note.id, { readonly: true });
      useNotesStore.getState().selectNote((await api.notes.get(note.id))!);
    });
    if (width === 390) await expect(page.getByRole("button", { name: "文档属性" })).toHaveText("跨端工具验证");
    else await expect(page.locator(".note-title")).toHaveValue("跨端工具验证");
    await expect(page.locator(".header-clock, .document-security-bar")).toHaveCount(0);
    await expect(page.getByTitle("专注模式").locator("svg")).toHaveCount(1);
    await expect(page.locator(".note-title-row .document-bookmark-toggle")).toContainText("1");
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { setReadonlyRenderingEnabled } = await load("/src/lib/readonly-rendering.ts") as typeof import("../src/lib/readonly-rendering");
      setReadonlyRenderingEnabled(true);
    });
    const titlebar = page.locator(".vr-title");
    await expect(titlebar.getByRole("button", { name: "文档目录" })).toHaveAttribute("aria-expanded", "false");
    const bookmarks = titlebar.getByRole("button", { name: "文档书签" });
    await expect(bookmarks.locator(".focus-bookmark-count")).toHaveText("1");
    await expect(page.getByRole("button", { name: "专注模式", exact: true }).locator("svg")).toHaveCount(1);
    await page.getByRole("button", { name: "专注模式", exact: true }).click();
    const focus = page.locator(".vr-title");
    await expect(page.getByRole("button", { name: "退出专注模式", exact: true })).toBeVisible();
    await expect(focus.getByRole("button", { name: "文档书签" })).toContainText("1");
    // Read-only titles toggle properties on both desktop and mobile.
    const focusTitle = focus.getByRole("button", { name: "文档属性", exact: true });
    const titlePanel = page.locator(".properties-panel");
    await focusTitle.click();
    await expect(titlePanel).toBeVisible();
    await expect(focus.getByRole("tooltip")).toHaveCount(0);
    if (width === 390) await page.getByTitle("关闭属性面板", { exact: true }).click();
    else await focusTitle.click();
    await expect(titlePanel).toBeHidden();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
    await expect(titlebar).toBeVisible();
  });
}
