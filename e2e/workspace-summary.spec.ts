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
  await page.evaluate(async () => { const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "sidebar" }); });
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
  const lastCounter = (await summary.getByRole("button", { name: "查看最近打开文档" }).boundingBox())!;
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
    // A fresh summary after navigating home starts a new restore snapshot.
    await summary.getByRole("button", { name: "查看全部文档", exact: true }).click();
    await summary.getByRole("button", { name: "查看全部文档", exact: true }).click();
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(width);

  });
}

test("手机摘要保留文档、今日修改和最近打开，点击使用文档列表弹层", async ({ page }) => {
  const counts = await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  await expect(summary.getByRole("button")).toHaveCount(3);
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

test("四项摘要悬停预览，最多十五行，长标题省略且滚动后可打开文档", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(async () => { const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "hover" }); });
  const longTitle = "摘要预览长标题：" + "保留完整名称但不会撑宽弹层".repeat(12);
  await page.evaluate(async longTitle => {
    const { api } = await import("/src/lib/api.ts");
    const { toggleDocumentFavorite } = await import("/src/lib/document-favorites.ts");
    for (let i = 0; i < 80; i++) {
      const note = await api.notes.create({ title: i === 79 ? longTitle : `摘要预览 ${i}`, date: "2026-10-10", storagePath: i % 5 === 0 ? "ideas/notes/group" : "projects/summary", content: { ops: [] } });
      if (i === 79) toggleDocumentFavorite(note.id);
    }
  }, longTitle);
  await page.reload();
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  await expect(summary).toHaveAttribute("aria-busy", "false");
  const before = await page.locator(".app-main-split").boundingBox();
  for (const [name, title, kind] of [["查看全部文档", "全部文档", "all"], ["查看随记", "随记", "notes"], ["查看今日修改文档", "今日修改", "today"], ["查看收藏文档", "收藏", "favorites"]]) {
    await summary.getByRole("button", { name, exact: true }).hover();
    const popup = page.getByRole("dialog", { name: `${title}预览`, exact: true });
    await expect(popup).toBeVisible();
    await expect(page.locator(".workspace-summary-preview")).toHaveCount(1);
    const count = await summary.locator(`.exhibition-summary-${kind} strong`).textContent();
    await expect(popup.locator(".workspace-summary-preview-heading strong span")).toHaveText(String(kind === "all" ? Number(count) : Math.min(15, Number(count))));
    const bounds = (await popup.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(992);
    expect(bounds.height).toBeLessThanOrEqual(466);
  }
  await summary.getByRole("button", { name: "查看全部文档", exact: true }).hover();
  const popup = page.getByRole("dialog", { name: "全部文档预览", exact: true });
  const long = popup.getByRole("button", { name: longTitle, exact: true });
  await expect(long).toHaveAttribute("title", longTitle);
  await long.hover();
  await expect(long).toHaveCSS("text-overflow", "ellipsis");
  expect(await long.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const list = popup.locator("ul");
  await expect.poll(() => list.evaluate(element => element.clientHeight)).toBe(428);
  expect(await long.evaluate(element => element.getBoundingClientRect().height)).toBe(28);
  expect(await list.evaluate(element => {
    const box = element.getBoundingClientRect();
    return [...element.querySelectorAll("li button")].filter(button => { const row = button.getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; }).length;
  })).toBeLessThanOrEqual(15);
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await popup.locator("li button").count()).toBeLessThan(30);
  expect(await page.locator(".app-main-split").boundingBox()).toEqual(before);
  await popup.screenshot({ path: test.info().outputPath("summary-hover.png") });
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const last = popup.getByRole("button", { name: "摘要昨日文档", exact: true });
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page.locator(".note-title:visible")).toHaveValue("摘要昨日文档");
  await expect(popup).toHaveCount(0);
  await summary.getByRole("button", { name: "查看随记", exact: true }).hover();
  await expect(page.getByRole("dialog", { name: "随记预览", exact: true })).toBeVisible();
  await page.locator(".exhibition-overview h2").hover();
  await expect(page.locator(".workspace-summary-preview")).toHaveCount(0);
});

test("摘要预览支持键盘到末项和 Escape，不影响统计点击及手机模式", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "hover" });
    for (let i = 0; i < 65; i++) await api.notes.create({ title: `键盘预览 ${i}`, date: "2026-10-10", storagePath: "projects", content: { ops: [] } });
  });
  await page.reload();
  await expect(page.getByRole("navigation", { name: "工作区统计" })).toHaveAttribute("aria-busy", "false");
  const all = page.getByRole("button", { name: "查看全部文档", exact: true });
  await all.focus();
  await page.keyboard.press("ArrowDown");
  const popup = page.getByRole("dialog", { name: "全部文档预览", exact: true });
  await expect(popup.locator("li button").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(popup.locator("li button").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(all).toBeFocused();
  await all.hover();
  await expect(popup).toBeVisible();
  await all.focus();
  await page.keyboard.press("ArrowDown");
  await expect(popup.locator("li button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "sidebar" }); });
  await all.click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole("region", { name: "文档列表", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await all.dispatchEvent("pointerenter", { pointerType: "touch" });
  await expect(popup).toHaveCount(0);
});

for (const mode of ["split-open", "split-hidden", "overlay-pinned", "overlay-hidden"] as const) {
  const hidden = mode.endsWith("hidden");
  test(`汇总按钮再次点击恢复原分栏：${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seed(page);
    await page.evaluate(({ hidden, mode }) => {
      localStorage.setItem("nr:sidebarPresentation", mode.startsWith("overlay") ? "overlay" : "split");
      localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", hidden, pinned: mode === "overlay-pinned" }));
      localStorage.setItem("nr:sidebarHidden", String(hidden));
      localStorage.setItem("nr:treeSidebarW", "470");
    }, { hidden, mode });
    await page.reload();
    const summary = page.getByRole("navigation", { name: "工作区统计" });
    await expect(summary).toHaveAttribute("aria-busy", "false");
    const sidebar = page.locator("#workspace-sidebar");
    await summary.getByRole("button", { name: "查看今日修改文档", exact: true }).click();
    await expect(page.getByRole("region", { name: "文档列表", exact: true })).toBeVisible();
    // Switching counters retains the original layout as the restore target.
    await summary.getByRole("button", { name: "查看随记", exact: true }).click();
    await expect(page.getByRole("region", { name: "随记列表", exact: true })).toBeVisible();
    await summary.getByRole("button", { name: "查看随记", exact: true }).click();
    if (hidden) await expect(sidebar).toHaveClass(/sidebar-hidden/);
    else await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect(page.locator('[data-sidebar-panel="tree"]')).toHaveAttribute("aria-pressed", String(!hidden));
    if (!hidden) await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(470);
    expect(await page.evaluate(() => localStorage.getItem("nr:treeSidebarW"))).toBe("470");
    if (mode.startsWith("overlay")) {
      await expect.poll(() => page.locator(".sidebar-pin-spacer").evaluate(element => element.getBoundingClientRect().width)).toBe(hidden ? 0 : 474);
    }
  });
}

test("最近打开弹层取访问记录，分栏仍展示最近编辑十五份", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { rememberRecentNote } = await import("/src/lib/quick-switcher.ts");
    for (let i = 0; i < 20; i++) { const note = await api.notes.create({ title: `最近编辑文档 ${i}`, date: "2026-10-10", storagePath: "ideas/recent", content: { ops: [] } }); rememberRecentNote(note.id); }
  });
  await page.reload();
  await page.evaluate(async () => { const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "hover" }); });
  const button = page.getByRole("button", { name: "查看最近打开文档", exact: true });
  await expect(button).toContainText("16");
  await button.hover();
  await expect(page.locator(".workspace-summary-preview li button")).toHaveCount(16);
  await page.evaluate(async () => { const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts"); saveWorkspaceLayout({ summaryInteraction: "sidebar" }); });
  await button.click();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await expect(list.locator(".document-browser-row")).toHaveCount(15);
  await expect(list.getByRole("button", { name: "最近编辑 · 15 份", exact: true })).toBeVisible();
});

test("恢复原文档列表的视图和筛选，不沿用临时统计条件", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.locator('[data-sidebar-panel="list"]').click();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await list.getByRole("button", { name: "全部文档", exact: true }).click();
  await page.getByRole("button", { name: "搜索文档", exact: true }).click();
  const search = list.getByRole("textbox", { name: "查找文档", exact: true });
  await search.fill("摘要昨日");
  await expect(list.locator(".document-browser-row")).toHaveCount(1);
  const today = page.getByRole("button", { name: "查看今日修改文档", exact: true });
  await today.click();
  await expect(list).not.toContainText("摘要昨日文档");
  await today.click();
  await expect(search).toHaveValue("摘要昨日");
  await expect(list.locator(".document-browser-row")).toHaveCount(1);
  await expect(list).toContainText("摘要昨日文档");
  await expect(today).toHaveAttribute("aria-pressed", "false");
});

test("布局设置选择点击弹层和六行上限，离开保持、再次点击收起且刷新保留", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await page.getByRole("button", { name: /打开布局设置/ }).click();
  const mode = page.getByRole("group", { name: "汇总项交互方式", exact: true });
  await mode.getByRole("button", { name: "点击显示弹层", exact: true }).click();
  await expect(mode.getByRole("button", { name: "点击显示弹层", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("spinbutton", { name: "弹层最多显示的文档数", exact: true }).fill("6");
  await page.reload();
  const button = page.getByRole("button", { name: "查看全部文档", exact: true });
  const popup = page.getByRole("dialog", { name: "全部文档预览", exact: true });
  await button.hover();
  await expect(popup).toHaveCount(0);
  const before = await page.locator(".app-main-split").boundingBox();
  await button.click();
  await expect(popup).toBeVisible();
  const list = popup.locator("ul");
  await expect(list).toHaveCSS("max-height", "176px");
  await page.mouse.move(1590, 50);
  await expect(popup).toBeVisible();
  const after = await page.locator(".app-main-split").boundingBox();
  expect(after).toEqual(before);
  await button.click();
  await expect(popup).toHaveCount(0);
  await button.click();
  await popup.getByRole("button", { name: "摘要昨日文档", exact: true }).click();
  await expect(page.locator(".note-title:visible")).toHaveValue("摘要昨日文档");
});

test.describe("触屏汇总", () => {
  test.use({ hasTouch: true });
  test("手机悬停模式点击可打开同一预览，不打开分栏", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    saveWorkspaceLayout({ summaryInteraction: "hover", summaryVisibleRows: 5 });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-tab-hide").click();
  const button = page.getByRole("button", { name: "查看全部文档", exact: true });
  await button.tap();
  const popup = page.getByRole("dialog", { name: "全部文档预览", exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.locator("ul")).toHaveCSS("max-height", "148px");
  const bounds = (await popup.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("dialog", { name: "文档视图", exact: true })).toHaveCount(0);
  await popup.getByRole("button", { name: "摘要昨日文档", exact: true }).tap();
  await expect(popup).toHaveCount(0);
  await expect(page.locator(".note-title:visible")).toHaveValue("摘要昨日文档");
});

});

test("默认点击显示弹层，悬停不会弹出，也不打开分栏", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(() => localStorage.removeItem("nr:workspaceLayout"));
  await page.reload();
  const summary = page.getByRole("navigation", { name: "工作区统计" });
  await expect(summary).toHaveAttribute("aria-busy", "false");
  const button = summary.getByRole("button", { name: "查看全部文档", exact: true });
  const popup = page.getByRole("dialog", { name: "全部文档预览", exact: true });
  const before = await page.locator("#workspace-sidebar").getAttribute("class");
  await button.hover();
  await expect(popup).toHaveCount(0);
  await button.click();
  await expect(popup).toBeVisible();
  expect(await page.locator("#workspace-sidebar").getAttribute("class")).toBe(before);
  await button.click();
  await expect(popup).toHaveCount(0);
});

test("四种弹层最新在下方，最近打开十六份与其他十五份编号直接打开", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { withDB } = await import("/src/lib/storage/db.ts");
    const { rememberRecentNote } = await import("/src/lib/quick-switcher.ts");
    const { toggleDocumentFavorite } = await import("/src/lib/document-favorites.ts");
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    saveWorkspaceLayout({ summaryInteraction: "click", summaryVisibleRows: 6 });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const note = await api.notes.create({ title: `编号文档 ${i}`, date: "2026-10-10", storagePath: "ideas/notes", content: { ops: [{ insert: "保持正文不变\n" }] } });
      ids.push(note.id);
      toggleDocumentFavorite(note.id);
      rememberRecentNote(note.id);
    }
    // Edit dates differ from visits: an old, unedited note can be the newest visit.
    await withDB(db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction("notes", "readwrite");
      ids.forEach((id, i) => {
        const request = tx.objectStore("notes").get(id);
        request.onsuccess = () => {
          const timestamp = new Date(); timestamp.setTime(Date.now() + i * 60000);
          tx.objectStore("notes").put({ ...request.result, updated_at: timestamp.toISOString() });
        };
      });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }));
    useNotesStore.getState().selectNote((await api.notes.get(ids[19]))!);
  });
  await expect(page.locator(".note-title:visible")).toHaveValue("编号文档 19");
  for (const [buttonName, title] of [["查看最近打开文档", "最近打开"], ["查看随记", "随记"], ["查看今日修改文档", "今日修改"], ["查看收藏文档", "收藏"]]) {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    const popup = page.getByRole("dialog", { name: `${title}预览`, exact: true });
    const recent = title === "最近打开";
    await expect(popup.locator("li button")).toHaveCount(recent ? 16 : 15);
    await expect(popup.locator("li button").first()).toContainText(recent ? "编号文档 4" : "编号文档 5");
    await expect(popup.locator("li button").last()).toContainText("编号文档 19");
    await expect(popup.locator(".workspace-summary-shortcut")).toHaveText([...(recent ? "0123456789abcdef" : "0123456789abcde")]);
    if (!recent) { await page.keyboard.press("f"); await expect(popup).toBeVisible(); }
    await page.keyboard.press("a");
    await expect(page.locator(".note-title:visible")).toHaveValue(recent ? "编号文档 14" : "编号文档 15");
    await expect(popup).toHaveCount(0);
  }
  // Open an old unedited document: visit order, not its edit timestamp, wins.
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = (await api.docs.search({})).find(note => note.title === "编号文档 0")!;
    useNotesStore.getState().selectNote((await api.notes.get(note.id))!);
  });
  await expect(page.locator(".note-title:visible")).toHaveValue("编号文档 0");
  await page.getByRole("button", { name: "查看最近打开文档", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "最近打开预览", exact: true });
  await expect(popup.locator("li button").last()).toContainText("编号文档 0");
  await page.keyboard.press("F");
  await expect(popup).toHaveCount(0);
  await expect(page.locator(".note-title:visible")).toHaveValue("编号文档 0");
});

test("悬停编号弹层不截获正文输入，关闭后编号不再生效", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  await page.evaluate(async () => {
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    saveWorkspaceLayout({ summaryInteraction: "hover" });
  });
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  const id = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await page.getByRole("button", { name: "查看随记", exact: true }).hover();
  const popup = page.getByRole("dialog", { name: "随记预览", exact: true });
  await expect(popup).toBeVisible();
  await page.keyboard.type("0");
  await expect(editor).toContainText("0");
  expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(id);
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await editor.click();
  await page.keyboard.type("a");
  await expect(editor).toContainText("a");
  expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(id);
});

test("最近打开区分仅浏览和成功编辑，重新打开及深浅主题均保持状态", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seed(page);
  const ids = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
    saveWorkspaceLayout({ summaryInteraction: "click" });
    const viewed = await api.notes.create({ title: "仅浏览状态", date: "2026-10-10", storagePath: "ideas", content: { ops: [{ insert: "导入的既有内容\n" }] } });
    const edited = await api.notes.create({ title: "本机编辑状态", date: "2026-10-10", storagePath: "ideas", content: { ops: [] } });
    useNotesStore.getState().selectNote(viewed);
    return { viewed: viewed.id, edited: edited.id };
  });
  await expect(page.locator(".note-title:visible")).toHaveValue("仅浏览状态");
  await page.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    useNotesStore.getState().selectNote((await api.notes.get(id))!);
  }, ids.edited);
  await expect(page.locator(".note-title:visible")).toHaveValue("本机编辑状态");
  await page.locator(".ProseMirror:visible").fill("这次实际修改正文，并成功保存。");
  await expect.poll(() => page.evaluate(async () => {
    const { readRecentEditedNoteIds } = await import("/src/lib/quick-switcher.ts");
    return readRecentEditedNoteIds();
  })).toContain(ids.edited);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(async theme => { const { api } = await import("/src/lib/api.ts"); await api.config.set({ theme }); }, theme);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "工作区统计" })).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "查看最近打开文档", exact: true }).click();
    const popup = page.getByRole("dialog", { name: "最近打开预览", exact: true });
    const viewed = popup.getByRole("button", { name: "仅浏览状态", exact: true });
    const edited = popup.getByRole("button", { name: "本机编辑状态", exact: true });
    await expect(viewed).toHaveAttribute("data-edit-status", "viewed");
    await expect(edited).toHaveAttribute("data-edit-status", "edited");
    await expect(viewed).toHaveCSS("font-weight", "400");
    await expect(edited).toHaveCSS("font-weight", "600");
    expect(await viewed.evaluate(element => getComputedStyle(element).color)).not.toBe(await edited.evaluate(element => getComputedStyle(element).color));
    await viewed.click();
    await expect(page.locator(".note-title:visible")).toHaveValue("仅浏览状态");
  }
});
