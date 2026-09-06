import { expect, test, type Page } from "@playwright/test";

async function selectSingleLine(page: Page, text: string) {
  const editor = page.locator(".ProseMirror");
  // Touch WebKit does not implement Ctrl+A like desktop Chromium.
  // Verify a real selection before testing commands that operate on it.
  await editor.click();
  await editor.press("End");
  await editor.press("Shift+Home");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

async function seedViews(page: Page, view: "daily" | "tree" = "daily") {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const notes = [];
    for (const [title, path, pinned] of [["按钮随笔甲", undefined, true], ["按钮随笔乙", undefined, false], ["按钮文档甲", "projects/buttons", false], ["按钮文档乙", "areas/buttons", false]] as const) {
      notes.push(await api.notes.create({ date: day, title, content: { ops: [{ insert: `${title}正文\n` }] }, storagePath: path, pinned, tags: [title.includes("甲") ? "按钮标签甲" : "按钮标签乙"] }));
    }
    await api.daily.updateTodos({ date: "2000-01-01", todos: [{ id: "search-entry-todo", text: "共享搜索待办验证", done: true, order: 0, tags: [] }], todo_carryover: false });
    localStorage.setItem("nr:sidebarTab", "daily");
    localStorage.setItem("nr:sidebarHidden", "false");
    localStorage.setItem("nr:lastNote", notes[1].id);
    localStorage.setItem("nr:workspaceTarget", JSON.stringify({ kind: "note", noteId: notes[1].id }));
    localStorage.setItem("nr:docTreeCollapsed", "[]");
    return notes.map((note: { id: string }) => note.id);
  });
  await page.reload();
  if (await page.getByTitle("显示侧栏", { exact: true }).isVisible()) await page.getByTitle("显示侧栏", { exact: true }).click();
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "daily") await switcher.click();
  await page.locator(".sidebar-item").filter({ hasText: "按钮随笔乙" }).click();
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮随笔乙");
  if (await page.getByTitle("显示侧栏", { exact: true }).isVisible()) await page.getByTitle("显示侧栏", { exact: true }).click();
  if (view === "tree") await page.getByTitle("切换到文档", { exact: true }).click();
  return ids;
}

for (const width of [1280, 390]) {
  test.describe(`视图按钮 ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: width < 768 });

    test("随笔行内取消置顶只操作目标，不打开它或收起侧栏", async ({ page }) => {
      await seedViews(page);
      const item = page.locator(".sidebar-item").filter({ hasText: "按钮随笔甲" });
      const button = item.getByTitle("取消置顶");
      if (width < 768) await button.tap(); else await button.click();
      await expect(item.getByTitle("取消置顶")).toHaveCount(0);
      await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮随笔乙");
      await expect(page.locator(".app-sidebar")).not.toHaveClass(/sidebar-hidden/);
    });

    test("文档树没有选中文档时不显示可执行的重命名入口", async ({ page }) => {
      await seedViews(page, "tree");
      const rename = page.getByTitle("重命名当前文档");
      await expect(rename).toBeDisabled();
      const row = page.locator(".doc-tree-doc").filter({ hasText: "按钮文档甲" });
      await row.click();
      await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮文档甲");
      if (width < 768) await page.getByTitle("显示侧栏", { exact: true }).tap();
      await expect(rename).toBeEnabled();
      await rename.click();
      const input = page.locator(".doc-tree-rename-input");
      await expect(input).toBeFocused();
      await input.fill("文档按钮重命名完成");
      await input.press("Enter");
      await expect(page.locator(".doc-tree-doc").filter({ hasText: "文档按钮重命名完成" })).toBeVisible();
    });

    test("全部随笔模式的标签筛选实际改变列表", async ({ page }) => {
      await seedViews(page);
      await page.getByTitle("查看全部随笔").click();
      await expect(page.locator(".sidebar-item").filter({ hasText: "按钮随笔乙" })).toBeVisible();
      await page.locator(".tag-filter-chip").filter({ hasText: /^按钮标签甲$/ }).click();
      await expect(page.locator(".sidebar-item").filter({ hasText: "按钮随笔甲" })).toBeVisible();
      await expect(page.locator(".sidebar-item").filter({ hasText: "按钮随笔乙" })).toHaveCount(0);
      await page.locator(".tag-filter-chip").filter({ hasText: /^全部$/ }).click();
      await expect(page.locator(".sidebar-item").filter({ hasText: "按钮随笔乙" })).toBeVisible();
    });

    test("全部随笔模式下搜索和清除按钮更新独立结果面板", async ({ page }) => {
      await seedViews(page);
      await page.getByTitle("查看全部随笔").click();
      await expect(page.locator(".sidebar-item").filter({ hasText: "按钮随笔甲" })).toBeVisible();
      if (width < 768) {
        await page.locator(".sidebar-tab-hide").click();
        await page.getByTitle("搜索", { exact: true }).tap();
      }
      await page.getByPlaceholder("搜索笔记...").fill("按钮随笔乙");
      await page.getByPlaceholder("搜索笔记...").press("Enter");
      await expect(page.locator(".search-hit").filter({ hasText: "按钮随笔乙" })).toBeVisible();
      await expect(page.locator(".search-hit").filter({ hasText: "按钮随笔甲" })).toHaveCount(0);
      await page.getByPlaceholder("搜索笔记...").fill("按钮");
      await expect(page.locator(".search-hit")).toHaveCount(4);
      await page.getByTitle("筛选", { exact: true }).click();
      await page.locator(".search-filter-select").selectOption("projects");
      await expect(page.locator(".search-hit")).toHaveCount(1);
      await expect(page.locator(".search-hit")).toContainText("按钮文档甲");
      await page.locator(".search-filter-select").selectOption("");
      await expect(page.locator(".search-hit")).toHaveCount(4);
      await page.getByTitle("筛选", { exact: true }).click();
      await page.getByPlaceholder("搜索笔记...").fill("共享搜索待办验证");
      await expect(page.locator(".search-hit")).toHaveCount(1);
      await expect(page.locator(".search-hit")).toContainText("共享搜索待办验证");
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      await expect(page.locator(".search-results")).toHaveCount(0);
    });
  });
}

test.describe("手机工具栏状态恢复", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });
  test("点按禁用按钮后移动光标不会让下一条命令覆盖旧选区", async ({ page }) => {
    await seedViews(page);
    await page.locator(".sidebar-tab-hide").click();
    const editor = page.locator(".ProseMirror");
    await editor.fill("不应丢失的正文");
    await selectSingleLine(page, "不应丢失的正文");
    await page.getByTitle("更多编辑操作").tap();
    await page.getByRole("button", { name: "关闭更多编辑操作", exact: true }).tap();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const redo = page.getByTitle("重做 (Ctrl+Y)");
    await expect(redo).toBeDisabled();
    const rect = (await redo.boundingBox())!;
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await editor.press("End");
    await page.getByTitle("更多编辑操作").tap();
    await page.getByRole("button", { name: "↵ 块内换行", exact: true }).tap();
    await expect(editor).toContainText("不应丢失的正文");
    await expect(editor.locator("p > br:not(.ProseMirror-trailingBreak)")).toHaveCount(1);
  });

  for (const view of ["daily", "tree"] as const) {
    test(`更多菜单的字号、颜色、链接、图片和导出实际生效 ${view}`, async ({ page }) => {
      await seedViews(page, view);
      if (view === "tree") {
        await page.locator(".doc-tree-doc").filter({ hasText: "按钮文档甲" }).click();
        await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮文档甲");
        await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
      } else await page.locator(".sidebar-tab-hide").click();
      const editor = page.locator(".ProseMirror");
      await expect(editor).toHaveText(view === "tree" ? "按钮文档甲正文" : "按钮随笔乙正文");
      await editor.fill("更多操作正文");
      await selectSingleLine(page, "更多操作正文");
      const more = page.getByRole("dialog", { name: "更多编辑操作", exact: true });
      await page.getByTitle("更多编辑操作").tap();
      await more.getByRole("combobox", { name: "文字字号", exact: true }).selectOption("24");
      await expect(editor.locator('span[style*="font-size"]')).toHaveCSS("font-size", "24px");
      await more.getByLabel("文字颜色", { exact: true }).fill("#ff0000");
      await expect(editor.locator('span[style*="color"]')).toHaveCSS("color", "rgb(255, 0, 0)");
      await more.getByRole("button", { name: "清除文字颜色", exact: true }).tap();
      await expect(editor.locator('span[style*="color"]')).toHaveCount(0);
      const size = await editor.evaluate((el) => getComputedStyle(el).fontSize);
      await more.getByRole("button", { name: "放大编辑器字号", exact: true }).tap();
      await expect(editor).toHaveCSS("font-size", `${parseFloat(size) + 1}px`);
      await more.getByRole("button", { name: "缩小编辑器字号", exact: true }).tap();
      await expect(editor).toHaveCSS("font-size", size);
      await more.getByRole("button", { name: "🔗 添加或编辑链接", exact: true }).tap();
      await page.getByPlaceholder("https://...", { exact: true }).fill("https://example.com/reader");
      await page.locator(".image-dialog").getByRole("button", { name: "插入", exact: true }).tap();
      await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/reader");
      await expect(editor.locator("a")).toHaveText("更多操作正文");
      await editor.press("End");
      await page.getByTitle("更多编辑操作").tap();
      await more.getByRole("button", { name: "🖼 插入图片", exact: true }).tap();
      await page.getByPlaceholder("图片 URL 或 base64").fill("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
      await page.locator(".image-dialog").getByRole("button", { name: "插入", exact: true }).tap();
      await expect(editor.locator("img")).toHaveCount(1);
      await page.getByTitle("更多编辑操作").tap();
      const download = page.waitForEvent("download");
      await more.getByRole("button", { name: "M↑ 导出 Markdown", exact: true }).tap();
      expect((await download).suggestedFilename()).toMatch(/\.md$/);
      await expect(editor).toContainText("更多操作正文");
    });
  }
});

test("桌面随笔行内只读、日期和删除按钮不切换当前笔记", async ({ page }) => {
  await seedViews(page);
  const item = page.locator(".sidebar-item").filter({ hasText: "按钮随笔甲" });
  await item.hover();
  await item.getByTitle("设为只读", { exact: true }).click();
  await expect(item.locator(".sidebar-item-ro-icon")).toBeVisible();
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮随笔乙");
  await item.getByTitle("移至其他日期").click();
  const dialog = page.getByRole("dialog", { name: "移至日期", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮随笔乙");
  await item.hover();
  await item.getByTitle("删除", { exact: true }).click();
  await expect(item).toHaveCount(0);
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮随笔乙");
});

for (const width of [1440, 390]) {
  for (const view of ["daily", "tree"] as const) {
    test.describe(`正文按钮矩阵 ${view} ${width}px`, () => {
      test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 });
      test("样式、全部标题级别、列表、引用、代码、缩进和撤销重做", async ({ page }) => {
        test.setTimeout(60000);
        await seedViews(page, view);
        if (view === "tree") {
          await page.locator(".doc-tree-doc").filter({ hasText: "按钮文档甲" }).click();
          await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("按钮文档甲");
        }
        if (!(await page.locator(".app-sidebar").getAttribute("class"))?.includes("sidebar-hidden")) await page.locator(".sidebar-tab-hide").click();
        const editor = page.locator(".ProseMirror");
        await editor.fill("按钮功能正文");
        const action = async (group: string, mobile: string, desktop: string) => {
          if (width < 768) {
            await page.getByTitle(group, { exact: true }).tap();
            await page.getByRole("button", { name: mobile, exact: true }).tap();
          } else await page.getByTitle(desktop, { exact: true }).click();
        };
        for (const [name, title, tag] of [["B 加粗", "加粗 (Ctrl+B)", "strong"], ["I 斜体", "斜体 (Ctrl+I)", "em"], ["S 删除线", "删除线 (Ctrl+Shift+X)", "s"]]) {
          await selectSingleLine(page, "按钮功能正文");
          await action("样式", name, title);
          await expect(editor.locator(tag)).toHaveText("按钮功能正文");
          await action("样式", name, title);
          await expect(editor.locator(tag)).toHaveCount(0);
        }
        for (const level of [3, 4, 5, 1, 2, 6]) {
          if (width < 768) {
            await page.getByTitle("标题", { exact: true }).tap();
            if (level === 1) await page.getByTitle("切换 H3–5 / H1–2 H6").tap();
            await page.getByRole("button", { name: new RegExp(`^H${level} —`) }).tap();
          } else {
            if (level === 1) await page.getByTitle("H1–2 H6", { exact: true }).click();
            await page.getByTitle(`标题 ${level}`, { exact: true }).click();
          }
          await expect(editor.locator(`h${level}`)).toHaveText("按钮功能正文");
        }
        if (width < 768) await action("标题", "清除标题", "");
        else await page.getByTitle("标题 6", { exact: true }).click();
        for (const [name, title, selector] of [["❝ 引用", "引用 (Ctrl+Shift+B)", "blockquote"], ["• 无序列表", "无序列表 (Ctrl+Shift+8)", "ul"], ["1. 有序列表", "有序列表 (Ctrl+Shift+7)", "ol"]]) {
          await action("块", name, title);
          await expect(editor.locator(selector)).toHaveCount(1);
          await action("块", name, title);
          await expect(editor.locator(selector)).toHaveCount(0);
        }
        await action("块", "→ 增加块缩进（Tab）", "增加块缩进 (Tab)");
        await expect(editor.locator(":scope > p")).toHaveAttribute("data-indent", "1");
        await action("块", "← 减少块缩进（Shift+Tab）", "减少块缩进 (Shift+Tab)");
        await expect(editor.locator(":scope > p")).not.toHaveAttribute("data-indent", "1");
        await action("块", "⏹ 代码块", "代码块 (Ctrl+Alt+C)");
        await expect(editor.locator("code")).toHaveText("按钮功能正文");
        await editor.getByRole("button", { name: "折叠代码块", exact: true }).click();
        await expect(editor.locator(".code-block-wrap")).toHaveAttribute("data-collapsed", "true");
        await editor.getByRole("button", { name: "展开代码块", exact: true }).click();
        // Formatting transactions within the history delay are intentionally grouped.
        // Isolate this change so undo tests one command, not the preceding matrix.
        await page.waitForTimeout(600);
        await action("块", "⏹ 代码块", "代码块 (Ctrl+Alt+C)");
        await expect(editor.locator(".code-block-wrap")).toHaveCount(0);
        await page.getByTitle("撤销 (Ctrl+Z)").click();
        await expect(editor.locator(".code-block-wrap")).toHaveCount(1);
        await page.getByTitle("重做 (Ctrl+Y)").click();
        await expect(editor.locator(".code-block-wrap")).toHaveCount(0);
        await expect(editor).toHaveText("按钮功能正文");
      });
    });
  }
}
