import { expect, test, type Locator } from "@playwright/test";

test.describe("PWA 窄屏应用外壳", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("使用顶部入口导航且移动编辑器保持简洁", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".m-toolbar")).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);

    await page.getByTitle("搜索").click();
    const searchInput = page.locator(".search-input");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await expect(page.locator(".editor-block-insert").first()).toBeVisible();
    await expect(page.locator(".editor-status-secondary")).toBeHidden();

    const bullet = editor.locator("li").first();
    await expect(bullet).toBeVisible();
    await expect.poll(() => bullet.evaluate((element) => getComputedStyle(element).listStyleType))
      .toBe("none");
  });

  test("移动端块编号使用紧凑且可随位数扩展的 gutter", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^编辑器/ }).click();
    const lineNumberSetting = page.locator(".settings-field").filter({ hasText: "显示块编号" });
    await lineNumberSetting.locator(".settings-toggle").click();
    await page.getByLabel("关闭设置").click();

    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "28px");
    const geometry = await page.locator(".editor-content-shell").evaluate((shell) => {
      const number = shell.querySelector(".editor-block-number")!.getBoundingClientRect();
      const paragraph = shell.querySelector(".ProseMirror > *")!.getBoundingClientRect();
      return { numberRight: number.right, paragraphLeft: paragraph.left };
    });
    expect(geometry.numberRight).toBeLessThanOrEqual(geometry.paragraphLeft);
  });

  test("手机端可以点按块间加号插入空行", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const blocks = editor.locator(":scope > *");
    await expect(blocks.first()).toBeVisible();
    const initialBlockCount = await blocks.count();
    expect(initialBlockCount).toBeGreaterThan(1);
    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "24px");

    const insertButton = page.getByRole("button", { name: "在第 1 块后插入段落" });
    const geometry = await insertButton.evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const paragraphRect = document.querySelector(".ProseMirror > p")!.getBoundingClientRect();
      return {
        button: { width: buttonRect.width, height: buttonRect.height, right: buttonRect.right },
        paragraphLeft: paragraphRect.left,
      };
    });
    expect(geometry.button).toMatchObject({ width: 24, height: 24 });
    expect(geometry.button.right).toBeLessThanOrEqual(geometry.paragraphLeft);

    const box = await insertButton.boundingBox();
    if (!box) throw new Error("块间插入按钮不可见");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type("手机插入块");

    await expect(blocks).toHaveCount(initialBlockCount + 1);
    await expect(blocks.nth(1)).toHaveText("手机插入块");
  });

  test("专注模式保留极简标题栏并可按需展开编辑工具", async ({ page }) => {
    await page.goto("/");
    const title = await page.locator(".note-title").inputValue();
    await page.getByTitle("专注模式").click();

    await expect(page.locator(".app-header")).toBeHidden();
    const focusBar = page.getByLabel("专注模式工具栏");
    await expect(focusBar).toBeVisible();
    await expect(focusBar.locator(".mobile-focus-title")).toHaveText(title);
    await expect(page.locator(".editor-menu")).toBeHidden();

    await focusBar.getByTitle("更多编辑工具").click();
    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS("position", "fixed");
    const toolbarGeometry = await page.locator(".note-editor").evaluate((element) => {
      const focusBarRect = element.querySelector(".mobile-focus-bar")!.getBoundingClientRect();
      const toolbarElement = element.querySelector(".editor-menu")!;
      const toolbarRect = toolbarElement.getBoundingClientRect();
      const titleRect = element.querySelector(".note-title-row")!.getBoundingClientRect();
      const style = getComputedStyle(toolbarElement);
      return {
        focusBarBottom: focusBarRect.bottom,
        toolbar: { top: toolbarRect.top, right: toolbarRect.right, bottom: toolbarRect.bottom, left: toolbarRect.left },
        titleTop: titleRect.top,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    });
    expect(toolbarGeometry.toolbar.left).toBeGreaterThanOrEqual(0);
    expect(toolbarGeometry.toolbar.right).toBeLessThanOrEqual(toolbarGeometry.viewportWidth);
    expect(toolbarGeometry.toolbar.top).toBeGreaterThanOrEqual(toolbarGeometry.focusBarBottom);
    expect(toolbarGeometry.titleTop).toBeGreaterThanOrEqual(toolbarGeometry.toolbar.bottom);
    expect(toolbarGeometry.overflowX).toBe("visible");
    expect(toolbarGeometry.overflowY).toBe("visible");

    await page.getByTitle("样式").click();
    const boldButton = page.getByRole("button", { name: "B 加粗" });
    await expect(boldButton).toBeVisible();
    await expect.poll(() => boldButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === button || button.contains(hit);
    })).toBe(true);
    await focusBar.getByTitle("退出专注模式").click();
    await expect(focusBar).toHaveCount(0);
    await expect(page.locator(".app-header")).toBeVisible();
  });

  test("更多菜单始终完整限制在手机可视区域内", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("更多编辑操作").click();
    const menu = page.locator(".toolbar-more-list");
    await expect(menu).toBeVisible();
    const geometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    await expect(menu.getByRole("button", { name: /导出 Markdown/ })).toBeVisible();
  });

  test("选择文字后工具栏保留选区并能应用格式", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("测试文字");
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("测试文字");

    const touch = async (locator: Locator) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("touch target has no geometry");
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    await touch(page.getByTitle("样式"));
    const boldButton = page.getByRole("button", { name: "B 加粗" });
    await expect(boldButton).toBeVisible();
    await expect.poll(async () => boldButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return point === button || button.contains(point);
    })).toBe(true);
    await touch(page.getByTitle("标题"));
    await expect(boldButton).toBeHidden();
    await expect(page.getByRole("button", { name: /H3/ })).toBeVisible();
    await touch(page.getByTitle("样式"));
    await boldButton.click();
    await expect(editor.locator("strong")).toHaveText("测试文字");
    await expect(editor).toHaveCSS("-webkit-user-select", "text");
  });

  test("从文档弹层发起新建时先关闭弹层并把对话框放在最上层", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:sidebarHidden", "true"));
    await page.goto("/");

    await page.getByTitle("文档视图").click();
    const popup = page.locator(".doc-tree-popup-overlay");
    await expect(popup).toBeVisible();
    await popup.getByTitle("新建文档").click();

    await expect(popup).toHaveCount(0);
    const dialog = page.locator(".doc-create-dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.locator(".dialog-overlay").evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1200");
  });

  test("离线时明确提示但编辑器保持可用", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeEditable();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator(".web-status-banner.offline")).toContainText("当前离线");
    await expect(page.locator(".ProseMirror")).toBeEditable();
  });

  test("软键盘高度不会重复压缩覆盖层和正文滚动区", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-keyboard-height", "300px");
    });

    await page.getByTitle("显示侧栏").click();
    const sidebarBottom = await page.locator(".app-sidebar").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.round(rect.bottom);
    });
    const scrollPaddingBottom = await page.locator(".note-editor-scroll").evaluate(
      (element) => getComputedStyle(element).scrollPaddingBottom,
    );
    expect(sidebarBottom).toBe(760);
    expect(scrollPaddingBottom).not.toContain("300px");
  });

  test("应用外壳跟随 iOS Visual Viewport 偏移且底部不留空白", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-visual-viewport-offset-top", "120px");
      document.documentElement.style.setProperty("--app-visual-viewport-offset-left", "4px");
      document.documentElement.style.setProperty("--app-viewport-height", "430px");
      document.documentElement.style.setProperty("--app-viewport-width", "382px");
    });

    const rect = await page.locator(".app").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom };
    });
    expect(rect).toEqual({ top: 120, left: 4, width: 382, height: 430, bottom: 550 });
  });

  test("键盘打开时状态栏下方不重复保留安全区", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.add("web-keyboard-open"));
    await expect(page.locator(".app-main")).toHaveCSS("padding-bottom", "0px");
  });

  test("编辑状态下光标不会被底部边界遮挡", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^编辑器/ }).click();
    const statusSetting = page.locator(".settings-field").filter({ hasText: "编辑器状态栏" });
    await statusSetting.locator(".settings-toggle").click();
    await page.getByLabel("关闭设置").click();
    await expect(page.locator(".editor-stats")).toHaveCount(0);

    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 40 }, (_, index) => `移动编辑第 ${index + 1} 行`).join("\n"));
    await editor.press("Control+End");
    await page.setViewportSize({ width: 390, height: 430 });
    await editor.press("End");

    await expect.poll(() => page.evaluate(() => {
      const root = document.querySelector(".note-editor-scroll")!.getBoundingClientRect();
      const selection = window.getSelection();
      if (!selection?.rangeCount) return false;
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getBoundingClientRect();
      return rect.bottom <= root.bottom - 20;
    })).toBe(true);
  });
});

test("横屏手机保持单行工具栏且正文可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 390 });
  await page.goto("/");

  const toolbar = page.locator(".editor-menu");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveClass(/toolbar-minimal/);
  const layout = await toolbar.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
  expect(layout.viewportHeight).toBe(390);
  await expect(page.locator(".note-editor-scroll")).toBeVisible();
});

test("属性面板在窄屏中覆盖显示而不挤压正文", async ({ page }) => {
  await page.setViewportSize({ width: 1020, height: 640 });
  await page.goto("/");
  await page.getByTitle("显示属性面板").click();
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("移动属性面板测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".properties-panel")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 760 });
  const layout = await page.locator(".properties-panel").evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { position: style.position, right: Math.round(rect.right), width: Math.round(rect.width) };
  });
  expect(layout.position).toBe("fixed");
  expect(layout.right).toBe(390);
  expect(layout.width).toBeLessThanOrEqual(360);
});
