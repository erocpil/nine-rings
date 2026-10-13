import { expect, test } from "@playwright/test";
import { sourceInfo } from "./helpers/source-editor";
import type { Page } from "@playwright/test";
async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("nr:pluginsEnabled", "true");
    for (const [key, target, toolbar] of [["nr:pluginBookmarkDisplay", "bookmarks", ["bookmarks.reveal-current"]], ["nr:pluginNotesDisplay", "notes", ["notes.expand-all", "notes.refresh"]]] as const) {
      localStorage.setItem(key, JSON.stringify({ enabled: true, display: { target, font: "mono", fontSize: 18, rowHeight: 42, labelColor: "accent", tooltip: "path", showCounts: false, showMetadata: target === "notes", order: "name", toolbar } }));
    }
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({ title: "Zeta", storagePath: "ideas/notes/Week", content: { ops: [{ insert: "内容甲\n内容乙\n" }], metadata: { bookmarks: [
      { id: "first", position: 1, preview: "内容甲", label: "Zeta", createdAt: "2026-01-01" },
      { id: "second", position: 6, preview: "内容乙", label: "Alpha", createdAt: "2026-01-02" },
    ] } } });
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.locator(".note-title")).toHaveValue("Zeta");
}
for (const source of [false, true]) {
  test(`书签展示排序不改变锚点和跳转，停用回退：源码=${source}`, async ({ page }) => {
    await seed(page);
    if (source) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "文档书签", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "文档书签", exact: true });
    const list = panel.locator(".document-bookmark-list");
    await expect(list).toHaveAttribute("data-panel-display", "plugin");
    const rows = list.locator(".document-bookmark-jump");
    await expect(rows).toHaveText(["Alpha", "Zeta"]);
    await expect(list.locator(".document-bookmark-index")).toHaveCount(0);
    await expect(rows.first()).toHaveCSS("font-size", "18px");
    await expect(rows.first()).toHaveAttribute("title", "Alpha\n内容乙");
    await rows.first().click();
    if (source) {
      const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
      await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBeGreaterThan(1);
    } else await expect(rows.first()).toHaveAttribute("aria-current", "location");
    await panel.getByRole("button", { name: "定位当前书签", exact: true }).click();
    await page.evaluate(async () => {
      const { bookmarkDisplay } = await import("/src/lib/plugin-system/builtin-bookmark-display.ts");
      bookmarkDisplay.save({ ...bookmarkDisplay.read(), enabled: false });
    });
    await expect(list).not.toHaveAttribute("data-panel-display", "plugin");
    await expect(rows.first()).toContainText("Zeta");
    await expect(list.locator(".document-bookmark-index")).toHaveCount(2);
  });
}

test("随记展示保留分组、选中、筛选和展开，独立停用不影响书签", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    await api.notes.create({ title: "Alpha", storagePath: "ideas/notes/Week", content: { ops: [] } });
  });
  await page.getByRole("navigation", { name: "工作区面板" }).getByRole("button", { name: "随记", exact: true }).click();
  const panel = page.getByRole("region", { name: "随记列表", exact: true });
  await expect(panel).toHaveAttribute("data-panel-display", "plugin");
  const group = panel.getByRole("region", { name: "Week", exact: true });
  await expect(group.locator(".notes-panel-open").first()).toHaveText("Alpha");
  await expect(group.locator(".notes-panel-date")).toHaveCount(2);
  await expect(group.locator(".notes-group-toggle small")).toHaveCount(0);
  await expect(group.locator(".notes-panel-open").first()).toHaveCSS("font-size", "18px");
  await expect(group.locator(".notes-panel-open").first()).toHaveAttribute("title", "ideas/notes/Week/Alpha");
  await group.locator(".notes-group-toggle").click();
  await expect(group.locator(".notes-panel-row")).toHaveCount(0);
  await panel.getByRole("button", { name: "展开所有分组", exact: true }).click();
  await expect(group.locator(".notes-panel-row")).toHaveCount(2);
  await panel.getByRole("button", { name: "刷新随记", exact: true }).click();
  await expect(group.locator(".notes-panel-row.is-selected")).toHaveCount(1);
  await panel.getByRole("searchbox", { name: "筛选随记", exact: true }).fill("Alpha");
  await expect(group.locator(".notes-panel-row")).toHaveCount(1);
  await page.evaluate(async () => {
    const { notesDisplay } = await import("/src/lib/plugin-system/builtin-notes-display.ts");
    notesDisplay.save({ ...notesDisplay.read(), enabled: false });
  });
  await expect.poll(() => page.evaluate(async () => { const { panelDisplays } = await import("/src/lib/plugin-system/panel-display.ts"); return panelDisplays.get("bookmarks") !== null; })).toBe(true);
  await expect(panel).not.toHaveAttribute("data-panel-display", "plugin");
  await expect(panel.getByRole("searchbox", { name: "筛选随记", exact: true })).toHaveValue("Alpha");
  await expect(group.locator(".notes-panel-date")).toHaveCount(0);
  await expect(group.locator(".notes-group-toggle small")).toHaveText("1");
});

test("书签与随记配置独立保存，恢复默认不改变启用状态", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
  for (const name of ["书签", "随记"]) {
    await page.getByRole("button", { name: `${name}展示`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `${name}展示配置`, exact: true });
    await dialog.getByRole("spinbutton", { name: `${name}字号`, exact: true }).fill("17");
    await dialog.getByRole("combobox", { name: `${name}展示排序`, exact: true }).selectOption("recent");
    await expect(dialog.getByRole("status")).toContainText("已更新");
    await dialog.getByRole("button", { name: `恢复${name}展示默认设置`, exact: true }).click();
    await expect(dialog.getByRole("spinbutton", { name: `${name}字号`, exact: true })).toHaveValue("13");
    await expect(dialog.getByRole("combobox", { name: `${name}展示排序`, exact: true })).toHaveValue("host");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("checkbox", { name: `启用${name}展示`, exact: true })).toBeChecked();
  }
});

test("手机局部只读书签应用同一展示，跳转后收回面板", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await page.evaluate(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
  });
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  const panel = page.locator(".vr-panel[data-document-kind=bookmarks]");
  const list = panel.locator(".document-bookmark-list");
  await expect(list).toHaveAttribute("data-panel-display", "plugin");
  await expect(list.locator(".vr-bookmark")).toHaveText(["Alpha", "Zeta"]);
  await expect(list.locator(".vr-bookmark").first()).toHaveCSS("font-size", "18px");
  expect(await list.locator(".vr-bookmark").first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(42);
  await list.locator(".vr-bookmark").first().click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
});
