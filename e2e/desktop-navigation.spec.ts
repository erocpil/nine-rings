import { expect, test } from "@playwright/test";

test("阅读分栏按配置展开，切换文档分栏恢复紧凑宽度", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const sidebar = page.locator(".app-sidebar");
  const width = () => sidebar.evaluate(el => el.getBoundingClientRect().width);
  const reader = page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true });
  await reader.click();
  await expect.poll(width).toBeCloseTo(828, 0);
  await expect(sidebar.locator(".workspace-switch")).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(width).toBeCloseTo(1043, 0);
  await page.getByTitle("设置", { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  const ratio = page.locator(".settings-field").filter({ hasText: "阅读分栏占比" });
  await expect(ratio.locator(".settings-value")).toHaveText("67%");
  await page.getByRole("button", { name: "减小阅读分栏占比" }).click();
  await expect(ratio.locator(".settings-value")).toHaveText("66%");
  await expect.poll(width).toBeCloseTo(1027, 0);
  await page.keyboard.press("Escape");
  for (const name of ["文档树", "文档列表"]) {
    await page.locator(".desktop-activity-bar").getByRole("button", { name, exact: true }).click();
    await expect.poll(width).toBeCloseTo(360, 0);
    await reader.click();
    await expect.poll(width).toBeCloseTo(1027, 0);
  }
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await reader.click();
  await expect.poll(width).toBeCloseTo(1027, 0);
});

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
    const dialog = page.locator(".app-sidebar .document-browser");
    await expect(openList).toBeVisible();
    await openList.click();
    await expect(dialog).toBeVisible();
    await openList.click();
    await expect(dialog).toBeHidden();
    await expect(openList).toBeFocused();
    await openList.click();
    await page.getByRole("button", { name: "隐藏侧栏", exact: true }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
    await page.locator(".sidebar-document-list").getByRole("button", { name: "全局搜索", exact: true }).click();
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
    const title = page.locator(".desktop-focus-toolbar .mobile-focus-title");
    await expect(title).toHaveText("桌面导航验证");
    const titleBox = await title.boundingBox();
    expect(titleBox!.x).toBeGreaterThan(600);
    await title.click();
    await expect(page.locator(".properties-panel")).toBeVisible();
    await expect(page.locator(".mobile-focus-full-title")).toHaveCount(0);
    await page.locator(".properties-close").click();
    await page.keyboard.press("Control+Shift+f");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", String(!readonly));
    await expect(page.locator(".ProseMirror")).toContainText("保持原正文不变");
  });
}
