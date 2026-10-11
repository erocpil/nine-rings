import { openDocumentSidebar, openMobileDocumentPopup } from "./helpers/workspace";
import { expect, test, type Page } from "@playwright/test";


async function createDocument(page: Page, title: string, root?: string) {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  const previousNoteId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  if (root) await page.getByRole("combobox", { name: "顶级目录", exact: true }).selectOption(root);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .not.toBe(previousNoteId);
}

test.describe("移动端视图切换", () => {
  test.use({ viewport: { width: 600, height: 760 }, hasTouch: true });


  test("安装版重启后优先定位最近文档的目录路径", async ({ page }) => {
    // 先用桌面宽度创建嵌套文档，再模拟手机安装版冷启动时侧栏默认隐藏。
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByTitle("新建文档").click();
    await page.getByPlaceholder("文档标题...").fill("手机启动恢复文档");
    await page.getByRole("combobox", { name: "顶级目录", exact: true }).selectOption("references");
    await page.getByPlaceholder("子路径 (如 nine-rings)").fill("mobile-startup/deep");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("手机启动恢复文档");

    await page.evaluate(() => {
      localStorage.setItem("nr:sidebarHidden", "true");
      localStorage.setItem("nr:docTreeCollapsed", JSON.stringify([
        "references",
        "references/mobile-startup",
        "references/mobile-startup/deep",
      ]));
    });
    await page.setViewportSize({ width: 600, height: 760 });
    await page.reload();

    await expect(page.locator(".note-title")).toHaveValue("手机启动恢复文档");
    await openDocumentSidebar(page);

    const selected = page.locator(".doc-tree-selected");
    await expect(selected).toContainText("手机启动恢复文档");
    await expect(selected).toBeVisible();
    for (const folder of ["references", "mobile-startup", "deep"]) {
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

    const workspace = page.getByRole("navigation", { name: "工作区面板" });
    await expect(workspace.getByRole("button", { name: "文档树", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTitle("折叠所有目录")).toBeVisible();
    await expect(page.locator(".doc-tree-header, .doc-tree-title")).toHaveCount(0);

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
    const firstFolder = page.locator(".doc-tree-folder").filter({ has: page.locator("button.doc-tree-toggle") }).first();
    await expect(firstFolder.locator(".doc-tree-toggle")).toHaveAttribute("aria-expanded", "false");
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
    await expect(page.locator(".doc-tree-folder").filter({ has: page.locator(".doc-tree-name", { hasText: folderName }) }).locator("button.doc-tree-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(280);
  });

  test("切换移动文档列表保留侧栏的目录折叠状态", async ({ page }) => {
    await createDocument(page, "折叠状态同步测试文档", "projects");
    const sidebar = page.locator(".app-sidebar");
    await sidebar.getByTitle("折叠所有目录").click();
    const firstToggle = sidebar.getByRole("button", { name: /^(展开|折叠)目录 projects$/, exact: true });
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 600, height: 760 });
    const popup = await openMobileDocumentPopup(page);
    await expect(popup.getByRole("region", { name: "文档列表", exact: true })).toBeVisible();
    await expect(popup.getByRole("button", { name: "折叠状态同步测试文档", exact: true })).toBeVisible();
    await popup.getByRole("button", { name: "关闭文档视图", exact: true }).click();
    await openDocumentSidebar(page);
    await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
    await openMobileDocumentPopup(page);
    await popup.getByRole("button", { name: "关闭文档视图", exact: true }).click();
    await openDocumentSidebar(page);
    await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
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
    await page.keyboard.press("Alt+f");
    await expect(page.getByRole("search").getByLabel("在当前文档中查找")).toBeVisible();

    // Web E2E 没有 Tauri 标题栏；直接验证标题栏在 hide 前广播的同一事件。
    await page.evaluate(() => window.dispatchEvent(new Event("nine-rings:main-window-hide")));
    await expect(findInput).toHaveCount(0);
    await expect(page.locator(".search-match")).toHaveCount(0);
  });
});
