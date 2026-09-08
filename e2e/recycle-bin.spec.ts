import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true });

interface RecycleTestState {
  ids: string[];
  activeId: string;
  calls: string[];
  failIds: string[];
  hold: boolean;
  release: () => void;
  restores: number;
}

async function setup(page: Page, count = 3, standalone = true, presentation = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return page.evaluate(async ({ count, standalone, presentation }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const active = await api.notes.create({ title: "正常文档", date: "2026-09-08", storagePath: "projects/recycle-test" });
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const title = presentation ? ["跨平台设计回顾与待办清单", "阅读摘录：那些值得重新思考的问题，以及下一阶段的计划与实践", "周末随笔"][index % 3] : `待删 ${index + 1}`;
      const storagePath = presentation ? ["projects/nine-rings", "areas/reading/2026/书籍与长期研究笔记/移动端阅读体验", undefined][index % 3] : "projects/recycle-test";
      const note = await api.notes.create({ title, date: "2026-09-08", storagePath });
      await api.versions.checkpoint(note.id);
      await api.notes.delete(note.id);
      ids.push(note.id);
    }
    if (standalone) {
      const state: RecycleTestState = { ids, activeId: active.id, calls: [], failIds: [], hold: false, release: () => {}, restores: 0 };
      Object.assign(window, { recycleTest: state });
      const remove = api.recycle.permanentlyDelete;
      api.recycle.permanentlyDelete = async (id) => {
        state.calls.push(id);
        if (state.hold) await new Promise<void>((resolve) => { state.release = () => { state.hold = false; resolve(); }; });
        if (state.failIds.includes(id)) throw new Error("模拟删除失败");
        return remove(id);
      };
      const React = (await load("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { RecycleBin } = await load("/src/components/RecycleBin.tsx");
      const host = document.createElement("div");
      Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "99999" });
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(RecycleBin, { open: true, onClose: () => root.unmount(), onRestored: () => { state.restores++; } }));
    }
    return { ids, activeId: active.id };
  }, { count, standalone, presentation });
}

const panel = (page: Page) => page.getByRole("dialog", { name: "回收站", exact: true });
const row = (page: Page, number: number) => panel(page).locator(".recycle-item").filter({ has: page.getByText(`待删 ${number}`, { exact: true }) });
const accept = (page: Page) => page.locator(".ui-confirm-dialog").getByRole("button", { name: /^(永久删除|清空回收站|永久清理)$/ }).click();

test("批量删除可取消，部分失败保留勾选并可重试，处理中禁止其它操作", async ({ page }) => {
  const { ids, activeId } = await setup(page);
  await row(page, 1).getByRole("checkbox").check();
  await row(page, 2).getByRole("checkbox").check();
  const all = panel(page).getByRole("checkbox", { name: "全选回收站记录" });
  expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
  await panel(page).getByRole("button", { name: "删除所选（2）" }).click();
  await expect(page.locator(".ui-confirm-dialog")).toContainText("选中的 2 项");
  await page.locator(".ui-confirm-dialog").getByRole("button", { name: "取消" }).click();
  expect(await page.evaluate(() => (window as unknown as { recycleTest: RecycleTestState }).recycleTest.calls.length)).toBe(0);
  await page.evaluate((id) => {
    const state = (window as unknown as { recycleTest: RecycleTestState }).recycleTest;
    state.failIds = [id]; state.hold = true;
  }, ids[1]);
  await panel(page).getByRole("button", { name: "删除所选（2）" }).click();
  await accept(page);
  await expect(all).toBeDisabled();
  await expect(panel(page).getByLabel("关闭回收站")).toBeDisabled();
  await expect(panel(page).getByRole("button", { name: "清空回收站", exact: true })).toBeDisabled();
  await expect(row(page, 3).getByRole("button", { name: "恢复" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { recycleTest: RecycleTestState }).recycleTest.calls.length)).toBe(1);
  await page.evaluate(() => (window as unknown as { recycleTest: RecycleTestState }).recycleTest.release());
  await expect(panel(page).getByRole("alert")).toContainText("1 项未删除");
  await expect(panel(page).locator(".recycle-item")).toHaveCount(2);
  await expect(row(page, 2).getByRole("checkbox")).toBeChecked();
  await expect(row(page, 3).getByRole("checkbox")).not.toBeChecked();
  await page.evaluate(() => { (window as unknown as { recycleTest: RecycleTestState }).recycleTest.failIds = []; });
  await panel(page).getByRole("button", { name: "删除所选（1）" }).click();
  await accept(page);
  await expect(panel(page).locator(".recycle-item")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { recycleTest: RecycleTestState }).recycleTest.restores)).toBe(0);
  const remaining = await page.evaluate(async ({ ids, activeId }) => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    return { active: (await api.notes.get(activeId))?.id, trash: (await api.recycle.list()).map((note) => note.id), versions: (await api.versions.list(ids[0])).length };
  }, { ids, activeId });
  expect(remaining).toEqual({ active: activeId, trash: [ids[2]], versions: 0 });
});

test("清空只删除确认时的回收站记录，不删除正常文档或确认期间新增的记录", async ({ page }) => {
  const { activeId } = await setup(page);
  await panel(page).getByRole("button", { name: "清空回收站", exact: true }).click();
  await expect(page.locator(".ui-confirm-dialog")).toContainText("全部 3 项");
  await expect(page.locator(".ui-confirm-dialog")).toContainText("无法从回收站恢复");
  const newerId = await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    const note = await api.notes.create({ title: "确认期间新增", date: "2026-09-08" });
    await api.notes.delete(note.id);
    return note.id;
  });
  await accept(page);
  await expect(panel(page).getByRole("status")).toContainText("已永久删除 3 项");
  await expect(panel(page).locator(".recycle-item-name")).toHaveText("确认期间新增");
  expect(await page.evaluate(() => (window as unknown as { recycleTest: RecycleTestState }).recycleTest.restores)).toBe(0);
  expect(await page.evaluate(async ({ activeId, newerId }) => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    return !!await api.notes.get(activeId) && (await api.recycle.list()).some((note) => note.id === newerId);
  }, { activeId, newerId })).toBe(true);
  await panel(page).getByRole("button", { name: "清空回收站", exact: true }).click();
  await accept(page);
  await expect(panel(page).getByText("回收站是空的", { exact: true })).toBeVisible();
});

test("确认后已恢复的文档及历史版本不会被批量永久删除", async ({ page }) => {
  const { ids } = await setup(page, 2);
  await panel(page).getByRole("checkbox", { name: "全选回收站记录" }).check();
  await panel(page).getByRole("button", { name: "删除所选（2）" }).click();
  await page.evaluate(async (id) => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    await api.recycle.restore(id);
  }, ids[0]);
  await accept(page);
  await expect(panel(page).getByRole("alert")).toContainText("文档已恢复");
  expect(await page.evaluate(async (id) => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    return !!await api.notes.get(id) && (await api.versions.list(id)).length > 0;
  }, ids[0])).toBe(true);
});

test("实际文档树在永久删除和旧记录清理后不重载，恢复文档仍刷新", async ({ page }) => {
  const { ids } = await setup(page, 3, false);
  await page.reload();
  await expect(page.locator(".doc-tree")).toBeVisible();
  const tree = await page.locator(".doc-tree").elementHandle();
  await page.evaluate(async (id) => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    const dbPath = "/src/lib/storage/db.ts";
    const { withDB, getOne, putRecord }: typeof import("../src/lib/storage/db") = await import(/* @vite-ignore */ dbPath);
    await withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const note = await getOne<{ id: string; deleted_at: string }>(store, id);
      await putRecord(store, { ...note, deleted_at: "2000-01-01T00:00:00.000Z" });
    });
    Object.assign(window, { recycleTreeLoads: 0 });
    const load = api.docs.tree;
    api.docs.tree = (...args) => { (window as unknown as { recycleTreeLoads: number }).recycleTreeLoads++; return load(...args); };
  }, ids[1]);
  await page.getByRole("button", { name: "🗑 回收站", exact: true }).click();
  await row(page, 1).getByRole("button", { name: "永久删除", exact: true }).click();
  await accept(page);
  await expect(row(page, 1)).toHaveCount(0);
  await panel(page).getByRole("button", { name: "清理 30 天前的记录" }).click();
  await accept(page);
  await expect(panel(page).getByRole("status")).toContainText("已永久清理 1 条");
  expect(await page.evaluate(() => (window as unknown as { recycleTreeLoads: number }).recycleTreeLoads)).toBe(0);
  expect(await tree!.evaluate((element) => element.isConnected)).toBe(true);
  await row(page, 3).getByRole("button", { name: "恢复", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { recycleTreeLoads: number }).recycleTreeLoads)).toBeGreaterThan(0);
  await tree!.dispose();
});

test("窄屏大量回收记录仍可操作全选、批量删除和清空，取消全选正常", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await setup(page, 25);
  const bin = panel(page);
  const all = bin.getByRole("checkbox", { name: "全选回收站记录" });
  await all.check();
  await expect(bin.getByRole("button", { name: "删除所选（25）" })).toBeEnabled();
  await all.uncheck();
  await expect(bin.getByRole("button", { name: "删除所选（0）" })).toBeDisabled();
  await expect(all).toBeInViewport();
  for (const button of await bin.locator(".recycle-footer button").all()) await expect(button).toBeInViewport();
  const box = (await bin.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(480);
  expect(await bin.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("recycle-batch-mobile.png") });
});

for (const { width, height, theme } of [
  { width: 1280, height: 800, theme: "light" },
  { width: 390, height: 844, theme: "fu" },
  { width: 390, height: 844, theme: "dark" },
  { width: 320, height: 480, theme: "light" },
  { width: 844, height: 390, theme: "dark" },
]) {
  test(`回收站卡片与固定操作区布局 ${width}x${height} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await setup(page, 3, true, true);
    await page.evaluate(async (theme) => {
      const path = "/src/lib/theme.ts";
      const { applyTheme } = await import(/* @vite-ignore */ path);
      applyTheme(theme);
    }, theme);
    const bin = panel(page);
    await expect(bin.locator(".recycle-total")).toHaveText("3 项");
    await expect(bin.locator(".recycle-item-path").filter({ hasText: "随笔 · 2026-09-08" })).toHaveCount(1);
    const item = bin.locator(".recycle-item").first();
    const originalColor = await item.evaluate((element) => getComputedStyle(element).backgroundColor);
    // The whole 44px label is a touch target, not only the small checkbox.
    await item.locator(".recycle-item-select").tap({ position: { x: 2, y: 2 } });
    await expect(item.getByRole("checkbox")).toBeChecked();
    await expect(bin.getByRole("button", { name: "删除所选（1）" })).toBeEnabled();
    await expect.poll(() => item.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(originalColor);
    const titleLayout = await item.locator(".recycle-item-name").evaluate((element) => ({
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      width: element.getBoundingClientRect().width,
      infoWidth: element.parentElement!.getBoundingClientRect().width,
    }));
    expect(titleLayout.fontSize).toBeGreaterThanOrEqual(15);
    expect(titleLayout.width).toBeGreaterThanOrEqual(titleLayout.infoWidth - 1);
    await expect(bin.locator(".recycle-close")).toBeInViewport({ ratio: 1 });
    for (const button of await bin.locator(".recycle-footer button").all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await bin.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = (await bin.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    // Footer stays fixed when scrolling a list taller than its available space.
    const before = (await bin.locator(".recycle-footer").boundingBox())!.y;
    await bin.locator(".recycle-content").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect((await bin.locator(".recycle-footer").boundingBox())!.y).toBeCloseTo(before, 0);
    await bin.locator(".recycle-content").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`recycle-${width}-${theme}.png`) });
    await bin.getByRole("button", { name: "清空回收站", exact: true }).click();
    await accept(page);
    await expect(bin.getByText("回收站是空的", { exact: true })).toBeVisible();
    await expect(bin.locator(".recycle-footer")).toHaveCount(0);
    await expect(bin.locator(".recycle-total")).toHaveText("0 项");
    await page.screenshot({ path: testInfo.outputPath(`recycle-empty-${width}-${theme}.png`) });
  });
}
