import { expect, test } from "@playwright/test";

for (const readonly of [false, true]) {
  test(`桌面列表入口与全局查找在${readonly ? "只读" : "编辑"}模式可用`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    await page.evaluate(async readonly => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({ title: "桌面导航验证", date: "2026-09-09", storagePath: "references/navigation",
        content: { ops: [{ insert: "保持原正文不变\n" }] } });
      const current = await api.notes.update(note.id, { readonly });
      useNotesStore.getState().selectNote(current);
    }, readonly);
    await expect(page.locator(".note-title")).toHaveValue("桌面导航验证");
    const openList = page.getByRole("button", { name: "文档列表", exact: true });
    const dialog = page.getByRole("dialog", { name: "文档视图", exact: true });
    await expect(openList).toBeVisible();
    await openList.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openList).toBeFocused();
    await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await expect(openList).toBeVisible();
    await openList.click();
    await dialog.getByRole("button", { name: "全局搜索", exact: true }).click();
    const input = page.locator(".search-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(input).toBeHidden();
    for (const shortcut of ["Control+Shift+f", "Alt+e"]) {
      await page.keyboard.press(shortcut);
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      await input.press("Escape");
    }
    await page.getByRole("button", { name: "专注模式", exact: true }).first().click();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await page.keyboard.press("Control+Shift+f");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", String(!readonly));
    await expect(page.locator(".ProseMirror")).toContainText("保持原正文不变");
  });
}
