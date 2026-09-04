import { expect, test, type Page } from "@playwright/test";

async function createDocument(page: Page, title: string) {
  await page.goto("/");
  const previousNoteId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .not.toBe(previousNoteId);
}

test.describe("移动端视图切换", () => {
  test.use({ viewport: { width: 600, height: 760 }, hasTouch: true });

  test("移动端使用单一视图切换按钮并显示当前视图", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".m-toolbar")).toHaveCount(0);
    await page.getByTitle("显示侧栏").click();
    const viewSwitch = page.locator(".sidebar-view-switch");
    await expect(viewSwitch).toHaveCount(1);
    await expect(viewSwitch).toHaveAttribute("aria-label", "切换到随笔");
    await expect(viewSwitch).toContainText("📂");
    await expect(viewSwitch.locator(".sidebar-view-switch-label")).toHaveText("文档");
    await expect(viewSwitch.locator(".sidebar-view-switch-label")).toBeVisible();
    await viewSwitch.click();
    await expect(viewSwitch).toHaveAttribute("aria-label", "切换到文档");
    await expect(viewSwitch).toContainText("✏️");
    await expect(viewSwitch.locator(".sidebar-view-switch-label")).toHaveText("随笔");
    await page.locator(".sidebar-overlay").click({ position: { x: 590, y: 300 } });
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  });

  test("安装版重启后优先定位最近文档的目录路径", async ({ page }) => {
    // 先用桌面宽度创建嵌套文档，再模拟手机安装版冷启动时侧栏默认隐藏。
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByTitle("新建文档").click();
    await page.getByPlaceholder("文档标题...").fill("手机启动恢复文档");
    await page.getByPlaceholder("子路径 (如 nine-rings)").fill("mobile-startup/deep");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("手机启动恢复文档");

    await page.evaluate(() => {
      localStorage.setItem("nr:sidebarTab", "daily");
      localStorage.setItem("nr:sidebarHidden", "true");
      localStorage.setItem("nr:defaultViewConfigured", "1");
      localStorage.setItem("nr:docTreeCollapsed", JSON.stringify([
        "projects",
        "projects/mobile-startup",
        "projects/mobile-startup/deep",
      ]));
      const raw = localStorage.getItem("nine_rings_config");
      const config = raw ? JSON.parse(raw) : {};
      localStorage.setItem("nine_rings_config", JSON.stringify({ ...config, default_view: "daily" }));
    });
    await page.setViewportSize({ width: 600, height: 760 });
    await page.reload();

    await expect(page.locator(".note-title")).toHaveValue("手机启动恢复文档");
    await page.getByTitle("显示侧栏").click();
    const viewSwitch = page.locator(".sidebar-view-switch");
    await expect(viewSwitch).toHaveAttribute("aria-label", "切换到随笔");

    const selected = page.locator(".doc-tree-selected");
    await expect(selected).toContainText("手机启动恢复文档");
    await expect(selected).toBeVisible();
    for (const folder of ["projects", "mobile-startup", "deep"]) {
      const name = page.locator(`.doc-tree-folder > .doc-tree-name[title="${folder}"]`);
      await expect(name).toBeVisible();
      await expect(name.locator("..").locator(":scope > .doc-tree-toggle"))
        .toHaveAttribute("aria-expanded", "true");
    }
    await expect.poll(() => selected.evaluate((element) => {
      const root = element.closest(".doc-tree");
      if (!root) return false;
      const itemRect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return itemRect.top >= rootRect.top && itemRect.bottom <= rootRect.bottom;
    })).toBe(true);
  });
});

test.describe("会话位置恢复与编辑器查找", () => {
  test("默认随笔视图不会覆盖用户打开的文档目录", async ({ page }) => {
    await createDocument(page, "目录选择优先级测试");
    await page.evaluate(() => {
      localStorage.setItem("nr:sidebarTab", "tree");
      localStorage.setItem("nr:defaultViewConfigured", "1");
      const raw = localStorage.getItem("nine_rings_config");
      const config = raw ? JSON.parse(raw) : {};
      localStorage.setItem("nine_rings_config", JSON.stringify({ ...config, default_view: "daily" }));
    });
    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue("目录选择优先级测试");

    const folder = page.locator(".doc-tree-folder").first();
    const folderName = await folder.locator(".doc-tree-name").innerText();
    await folder.locator(".doc-tree-name").click();

    await expect(page.locator(".moc-breadcrumb")).toHaveText(folderName);
    await expect(page.locator(".sidebar-view-switch")).toHaveAttribute("aria-label", "切换到随笔");
    await expect(page.getByText("选择或新建一篇笔记", { exact: true })).toHaveCount(0);
  });

  test("过期待办入口位于今日待办标题栏", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");

    const todoList = page.locator(".todo-list");
    const overdueButton = todoList.getByRole("button", { name: "查看过期待办" });
    const exportButton = todoList.locator(".todo-export-btn");
    await expect(overdueButton).toBeVisible();
    await expect.poll(async () => {
      const overdueBox = await overdueButton.boundingBox();
      const exportBox = await exportButton.boundingBox();
      return Boolean(
        overdueBox
        && exportBox
        && overdueBox.x + overdueBox.width <= exportBox.x
        && overdueBox.width === 28
        && exportBox.width === 28,
      );
    }).toBe(true);
    await expect(overdueButton.locator("svg")).toHaveCount(1);
    await expect(exportButton.locator("svg")).toHaveCount(1);
    await expect(page.locator(".sidebar-footer").getByText("过期待办")).toHaveCount(0);
    await overdueButton.click();
    await expect(page.locator(".overdue-panel")).toBeVisible();
    await expect(page.locator(".overdue-header h3")).toHaveText("过期待办");
  });

  test("可隐藏待办并通过拖动分隔条重新打开", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");

    await page.getByRole("button", { name: "隐藏待办" }).click();
    await expect(page.locator(".app-main-todo")).toHaveCount(0);
    const divider = page.locator(".app-main-divider");
    await expect(divider).toHaveClass(/divider-collapsed/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:todoSplit"))).toBe("0");

    const box = await divider.boundingBox();
    if (!box) throw new Error("待办分隔条不可见");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 5 });
    await page.mouse.up();

    await expect(page.locator(".app-main-todo")).toBeVisible();
    await expect(divider).not.toHaveClass(/divider-collapsed/);
    await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("nr:todoSplit")))).toBeGreaterThan(0);
  });

  test("重载后恢复最后打开的文档、光标和滚动位置", async ({ page }) => {
    const title = "会话恢复测试文档";
    await createDocument(page, title);

    const editor = page.locator(".ProseMirror");
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `第 ${index + 1} 段：${"用于验证重启后位置恢复的正文。".repeat(4)}`,
    );
    await editor.fill(paragraphs.join("\n"));
    await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

    const anchor = editor.locator(":scope > p").nth(56);
    await anchor.scrollIntoViewIfNeeded();
    await anchor.click();

    const noteId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
    expect(noteId).toBeTruthy();
    const before = await page.locator(".note-editor-scroll").evaluate((element) => {
      const scroller = element as HTMLElement;
      scroller.scrollTop = Math.max(200, scroller.scrollHeight * 0.65);
      scroller.dispatchEvent(new Event("scroll"));
      return scroller.scrollTop;
    });
    expect(before).toBeGreaterThan(100);

    await expect.poll(() => page.evaluate(
      (id) => Number(localStorage.getItem(`scrollPos:${id}`)),
      noteId,
    )).toBeGreaterThan(100);
    await expect.poll(() => page.evaluate(
      (id) => localStorage.getItem(`selectionPos:${id}`),
      noteId,
    )).not.toBeNull();

    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue(title);
    await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
      (element) => (element as HTMLElement).scrollTop,
    )).toBeGreaterThan(100);
    await editor.focus();
    await expect.poll(() => page.locator(".ProseMirror").evaluate((element) => {
      const selection = window.getSelection();
      return Boolean(selection?.anchorNode && element.contains(selection.anchorNode));
    })).toBe(true);
  });

  test("重载后恢复文档树布局、目录视图和专注模式", async ({ page }) => {
    await createDocument(page, "工作区恢复测试文档");

    const sidebarTabs = page.locator(".sidebar-tabs");
    await expect(sidebarTabs.locator(".sidebar-view-switch")).toHaveAttribute("aria-label", "切换到随笔");
    await expect(sidebarTabs.locator(".sidebar-view-switch")).toHaveCount(1);
    await expect(sidebarTabs.getByTitle("折叠所有目录")).toBeVisible();
    await expect(page.locator(".doc-tree-header, .doc-tree-title")).toHaveCount(0);
    await expect(sidebarTabs.locator(".doc-tree-toolbar-host + .sidebar-tab-hide")).toBeVisible();

    const sidebar = page.locator(".app-sidebar");
    const divider = page.locator(".sidebar-divider");
    const dividerBox = await divider.boundingBox();
    if (!dividerBox) throw new Error("sidebar divider not found");
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(dividerBox.x + 74, dividerBox.y + 100, { steps: 5 });
    await page.mouse.up();
    const sidebarWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
    expect(sidebarWidth).toBeGreaterThan(280);

    await page.getByTitle("专注模式").click();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await expect(page.locator(".date-picker")).toBeHidden();
    await expect(page.locator(".header-clock")).toBeHidden();
    await expect(page.locator(".daily-overview")).toBeHidden();

    await page.getByTitle("折叠所有目录").click();
    const firstFolder = page.locator(".doc-tree-folder").first();
    await expect(firstFolder.locator(".doc-tree-toggle")).toHaveText("▶");
    const folderName = await firstFolder.locator(".doc-tree-name").innerText();
    await firstFolder.locator(".doc-tree-name").click();
    await expect(page.locator(".moc-breadcrumb")).toHaveText(folderName);
    await expect(page.locator(".ProseMirror")).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:workspaceTarget")))
      .toContain('"kind":"folder"');
    await page.reload();

    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await expect(page.locator(".moc-breadcrumb")).toHaveText(folderName);
    await expect(page.locator(".ProseMirror")).toHaveCount(0);
    await expect(page.locator(".doc-tree-folder").first().locator(".doc-tree-toggle")).toHaveText("▶");
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(280);
  });

  test("侧栏与弹出文档树共享折叠状态", async ({ page }) => {
    await createDocument(page, "折叠状态同步测试文档");

    const sidebar = page.locator(".app-sidebar");
    await sidebar.getByTitle("折叠所有目录").click();
    await expect(sidebar.locator(".doc-tree-folder .doc-tree-toggle").first()).toHaveText("▶");

    await page.getByTitle("隐藏侧栏").click();
    await page.getByTitle("文档视图").click();
    const popup = page.locator(".doc-tree-popup");
    await expect(popup).toBeVisible();
    await popup.getByTitle("折叠其它目录（保留当前文档所在目录）").click();
    await expect(popup.locator(".doc-tree-folder .doc-tree-toggle").filter({ hasText: "▼" }).first()).toBeVisible();

    await popup.getByRole("button", { name: "✕" }).click();
    await page.getByTitle("显示侧栏").click();
    await expect(sidebar.locator(".doc-tree-folder .doc-tree-toggle").filter({ hasText: "▼" }).first()).toBeVisible();
  });

  test("专注模式中文档查找浮层可见且在主窗口关闭时同步关闭", async ({ page }) => {
    await createDocument(page, "窗口内查找测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一处 current-find-target\n中间正文\n第二处 current-find-target");
    await page.getByTitle("专注模式").click();
    await expect(page.locator(".note-editor")).toHaveClass(/focus-mode/);
    const editorTopBefore = await editor.evaluate((element) => element.getBoundingClientRect().top);
    await editor.locator(":scope > p").nth(1).click();
    await page.keyboard.press("Alt+f");

    const findInput = page.getByRole("search").getByLabel("在当前文档中查找");
    await expect(findInput).toBeVisible();
    await expect(page.locator(".editor-find-bar")).toHaveCSS("position", "absolute");
    const editorTopAfter = await editor.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(editorTopAfter - editorTopBefore)).toBeLessThan(1);
    await findInput.fill("current-find-target");
    await expect(page.locator(".editor-find-count")).toHaveText("0/2");
    await findInput.press("Enter");
    await expect(page.locator(".editor-find-count")).toHaveText("2/2");

    await findInput.press("Escape");
    await expect(findInput).toHaveCount(0);
    await page.keyboard.press("Meta+f");
    await expect(page.getByRole("search").getByLabel("在当前文档中查找")).toBeVisible();

    // Web E2E 没有 Tauri 标题栏；直接验证标题栏在 hide 前广播的同一事件。
    await page.evaluate(() => window.dispatchEvent(new Event("nine-rings:main-window-hide")));
    await expect(findInput).toHaveCount(0);
    await expect(page.locator(".search-match")).toHaveCount(0);
  });
});
