import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" }));
  });
  await createBlankDocument(page, "摘要当前文档");
  const expected = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { toggleDocumentFavorite } = await import("/src/lib/document-favorites.ts");
    const { workspaceDocuments, workspaceCounts } = await import("/src/lib/workspace-summary.ts");
    const { localDateKey } = await import("/src/lib/local-date.ts");
    const old = await api.notes.create({ title: "摘要昨日文档", date: localDateKey(), storagePath: "projects/summary", content: { ops: [] } });
    const favorite = await api.notes.create({ title: "摘要收藏文档", date: localDateKey(), storagePath: "ideas/notes/group", content: { ops: [] } });
    await api.notes.create({ title: "摘要未分组随记", date: localDateKey(), storagePath: "ideas/notes", content: { ops: [] } });
    // Set a past timestamp in the persisted fixture; the normal update API
    // intentionally assigns the current time and is exercised separately.
    const { withDB } = await import("/src/lib/storage/db.ts");
    await withDB(db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction("notes", "readwrite");
      const store = tx.objectStore("notes");
      const request = store.get(old.id);
      request.onsuccess = () => {
        const date = new Date(); date.setDate(date.getDate() - 1);
        store.put({ ...request.result, updated_at: date.toISOString() });
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }));
    toggleDocumentFavorite(favorite.id);
    return workspaceCounts(workspaceDocuments(await api.docs.tree()), [favorite.id], localDateKey());
  });
  await page.reload();
  await expect(page.getByRole("navigation", { name: "工作区统计" })).toHaveAttribute("aria-busy", "false");
  return expected;
}

test("工作区摘要在收起和展开时可用，统计入口切换列表与随记，收藏即时更新", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const counts = await seed(page);
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  for (const kind of ["all", "notes", "today", "favorites"] as const) {
    await expect(summary.locator(`.exhibition-summary-${kind} strong`)).toHaveText(String(counts[kind]));
  }
  await expect(page.locator(".exhibition-columns")).toHaveCount(0);
  const lastCounter = (await summary.getByRole("button", { name: "查看收藏文档" }).boundingBox())!;
  const expand = (await page.getByRole("button", { name: "展开概览", exact: true }).boundingBox())!;
  expect(expand.x - lastCounter.x - lastCounter.width).toBeGreaterThanOrEqual(0);
  expect(expand.x - lastCounter.x - lastCounter.width).toBeLessThanOrEqual(20);
  await page.getByRole("button", { name: "展开概览", exact: true }).click();
  await expect(summary).toBeVisible();
  await page.getByRole("button", { name: "收起概览", exact: true }).click();
  await summary.getByRole("button", { name: "查看今日修改文档" }).click();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await expect(list.getByRole("button", { name: "清除今日修改筛选" })).toBeVisible();
  await expect(list).not.toContainText("摘要昨日文档");
  await expect(list).toContainText("摘要收藏文档");
  await summary.getByRole("button", { name: "查看收藏文档" }).click();
  await expect(list.locator(".document-browser-row")).toHaveCount(1);
  await list.getByRole("button", { name: "取消收藏 摘要收藏文档", exact: true }).click();
  await expect(summary.locator(".exhibition-summary-favorites strong")).toHaveText("0");
  await expect(list.locator(".document-browser-row")).toHaveCount(0);
  await summary.getByRole("button", { name: "查看全部文档" }).click();
  await expect(list).toContainText("摘要昨日文档");
  await expect(list.getByRole("button", { name: "清除今日修改筛选" })).toHaveCount(0);
  await list.getByRole("button", { name: "摘要昨日文档", exact: true }).click();
  await expect(page.locator(".note-title:visible")).toHaveValue("摘要昨日文档");
  await page.locator(".ProseMirror:visible").fill("更新昨日文档，自动保存后进入今日修改。");
  await expect(summary.locator(".exhibition-summary-today strong")).toHaveText(String(counts.today + 1));
  await summary.getByRole("button", { name: "查看今日修改文档" }).click();
  await expect(list).toContainText("摘要昨日文档");
  await summary.getByRole("button", { name: "查看随记" }).click();
  await expect(page.getByRole("region", { name: "随记列表", exact: true })).toContainText("摘要收藏文档");
  await page.screenshot({ path: test.info().outputPath("summary-desktop.png"), animations: "disabled" });
});

for (const mode of ["split", "pinned", "hidden", "hover"] as const) {
  test(`摘要切换复用固定宽度或统一列表宽度：${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seed(page);
    await page.evaluate(mode => {
      localStorage.setItem("nr:sidebarPresentation", mode === "split" ? "split" : "overlay");
      localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", hidden: mode === "hidden" || mode === "hover", pinned: mode === "pinned" }));
      localStorage.setItem("nr:sidebarHidden", String(mode === "hidden" || mode === "hover"));
      localStorage.setItem("nr:treeSidebarW", "470");
      localStorage.setItem("nr:listSidebarW", "390");
      localStorage.setItem("nr:notesSidebarW", "610");
    }, mode);
    await page.reload();
    const summary = page.getByRole("navigation", { name: "工作区统计" });
    await expect(summary).toHaveAttribute("aria-busy", "false");
    const sidebar = page.locator("#workspace-sidebar");
    if (mode === "hover") {
      await page.locator('[data-sidebar-panel="tree"]').hover();
      await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
      await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(470);
    }
    const width = mode === "split" || mode === "pinned" ? 470 : 390;
    let editorBounds: { x: number; width: number } | undefined;
    for (const name of ["查看随记", "查看全部文档", "查看今日修改文档", "查看收藏文档", "查看随记"]) {
      await summary.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(width);
      if (mode !== "split") await expect.poll(() => page.locator(".sidebar-pin-spacer").evaluate(element => element.getBoundingClientRect().width)).toBe(width + 4);
      const bounds = await page.locator(".app-main-split").boundingBox();
      if (editorBounds) {
        await expect.poll(async () => {
          const current = (await page.locator(".app-main-split").boundingBox())!;
          return Math.abs(current.width - editorBounds!.width) + Math.abs(current.x - editorBounds!.x);
        }).toBeLessThan(1);
      } else {
        editorBounds = bounds!;
      }
    }
    await page.setViewportSize({ width: 1580, height: 1000 });
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(width);
    await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
    await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(width);
    expect(await page.evaluate(() => localStorage.getItem("nr:notesSidebarW"))).toBe("610");
  });
}

test("手机摘要仅保留文档和今日修改，点击使用文档列表弹层", async ({ page }) => {
  const counts = await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  await expect(summary.getByRole("button")).toHaveCount(2);
  await expect(summary.getByRole("button", { name: "查看随记" })).toBeHidden();
  await expect(summary.getByRole("button", { name: "查看收藏文档" })).toBeHidden();
  await expect(summary.locator(".exhibition-summary-all strong")).toHaveText(String(counts.all));
  const bounds = (await summary.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("summary-mobile.png"), animations: "disabled" });
  await summary.getByRole("button", { name: "查看今日修改文档" }).click();
  const dialog = page.getByRole("dialog", { name: "文档视图", exact: true });
  await expect(dialog.getByRole("button", { name: "清除今日修改筛选" })).toBeVisible();
  await expect(dialog).not.toContainText("摘要昨日文档");
});

test("本地跨日更新摘要和已打开的今日修改列表", async ({ page }) => {
  const now = new Date(); now.setHours(23, 58, 0, 0);
  await page.clock.install({ time: now });
  const counts = await seed(page);
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  await summary.getByRole("button", { name: "查看今日修改文档" }).click();
  await page.clock.fastForward(121000);
  await expect(summary.locator(".exhibition-summary-today strong")).toHaveText("0");
  await expect(summary.locator(".exhibition-summary-all strong")).toHaveText(String(counts.all));
  await expect(page.getByRole("region", { name: "文档列表", exact: true }).locator(".document-browser-row")).toHaveCount(0);
});
