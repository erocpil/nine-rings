import { expect, test } from "@playwright/test";

test("阅读分栏默认半宽并记住拖动比例，三个分栏工具栏一致且不显示分栏名", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const sidebar = page.locator(".app-sidebar");
  const width = () => sidebar.evaluate(el => el.getBoundingClientRect().width);
  const reader = page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true });
  await reader.click();
  await expect.poll(width).toBeCloseTo(616, 0);
  const heading = sidebar.locator('.workspace-panel-heading').filter({ visible: true });
  await expect(heading.locator('.workspace-panel-title')).toHaveCount(0);
  const headingHeight = await heading.evaluate(el => el.getBoundingClientRect().height);
  await expect(page.locator('.app-header')).toHaveCount(0);
  await expect(heading.getByRole('button', { name: '隐藏侧栏' })).toHaveCount(0);
  await expect(sidebar.locator(".workspace-switch")).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(width).toBeCloseTo(776, 0);
  await page.getByTitle("设置", { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const ratio = page.locator(".settings-field").filter({ hasText: "阅读分栏占比" });
  await expect(ratio).toHaveCount(0);
  await page.locator('.settings-close').click();
  await expect(page.locator('.settings-overlay')).toBeHidden();
  const divider = await page.locator('.sidebar-divider').boundingBox();
  await page.mouse.move(divider!.x + divider!.width / 2, divider!.y + 100);
  await page.mouse.down();
  await page.mouse.move(divider!.x + divider!.width / 2 + 124, divider!.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(width).toBeCloseTo(900, 0);
  for (const [name, adjustedWidth] of [["文档树", 430], ["文档列表", 470]] as const) {
    await page.locator(".desktop-activity-bar").getByRole("button", { name, exact: true }).click();
    await expect.poll(width).toBeCloseTo(360, 0);
    await expect(heading.locator('.workspace-panel-title')).toHaveCount(0);
    expect(await heading.evaluate(el => el.getBoundingClientRect().height)).toBe(headingHeight);
    await expect(heading.getByRole('button', { name: '隐藏侧栏' })).toHaveCount(0);
    const panelDivider = await page.locator('.sidebar-divider').boundingBox();
    await page.mouse.move(panelDivider!.x + 2, panelDivider!.y + 100);
    await page.mouse.down();
    await page.mouse.move(panelDivider!.x + 2 + adjustedWidth - 360, panelDivider!.y + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(width).toBeCloseTo(adjustedWidth, 0);
    await reader.click();
    await expect.poll(width).toBeCloseTo(900, 0);
    await page.locator(".desktop-activity-bar").getByRole("button", { name, exact: true }).click();
    await expect.poll(width).toBeCloseTo(adjustedWidth, 0);
  }
  await reader.click();
  await expect.poll(width).toBeCloseTo(900, 0);
  // Resizing preserves the reading/editor ratio without overwriting it.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(width).toBeCloseTo(Math.round(900 * 952 / 1552), 0);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(width).toBeCloseTo(900, 0);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await reader.click();
  await expect.poll(width).toBeCloseTo(900, 0);
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
    await openList.click();
    await expect(dialog).toBeHidden();
    await openList.click();
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
    const title = page.locator(".note-title-row .note-title");
    await expect(title).toHaveValue("桌面导航验证");
    const titleBox = await title.boundingBox();
    expect(titleBox!.x).toBeGreaterThan(360);
    await title.click();
    await expect(page.locator(".properties-panel")).toBeVisible();
    await expect(page.locator(".mobile-focus-full-title")).toHaveCount(0);
    await title.click();
    await expect(page.locator(".properties-panel")).toBeHidden();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await title.click();
    await expect(page.locator(".properties-panel")).toBeVisible();
    await page.locator(".properties-close").click();
    await page.keyboard.press("Control+Shift+f");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await input.press("Escape");
    await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", String(!readonly));
    await expect(page.locator(".ProseMirror")).toContainText("保持原正文不变");
  });
}
