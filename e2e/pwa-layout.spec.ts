import { expect, test, type Locator } from "@playwright/test";

test.describe("PWA 窄屏应用外壳", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("使用顶部入口导航且移动编辑器保持简洁", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".m-toolbar")).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);

    const headerBeforeSearch = await page.locator(".app-header").boundingBox();
    const overviewBeforeSearch = await page.locator(".daily-overview").boundingBox();
    await page.getByTitle("搜索").click();
    const searchInput = page.locator(".search-input");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    const headerAfterSearch = await page.locator(".app-header").boundingBox();
    const overviewAfterSearch = await page.locator(".daily-overview").boundingBox();
    expect(headerAfterSearch?.height).toBeCloseTo(headerBeforeSearch?.height ?? 0, 0);
    expect(overviewAfterSearch?.height).toBeCloseTo(overviewBeforeSearch?.height ?? 0, 0);
    const overviewLines = await page.locator(".daily-overview > span").evaluateAll((items) =>
      items.map((item) => ({
        height: item.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(item).lineHeight),
      })),
    );
    for (const item of overviewLines) {
      expect(item.height).toBeLessThanOrEqual(item.lineHeight + 1);
    }

    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await expect(page.locator(".editor-block-insert")).toHaveCount(0);
    await expect(page.locator(".editor-status-secondary")).toBeHidden();

    await page.getByTitle("文档目录").click();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await expect(outline).toBeVisible();
    await expect(outline.getByLabel("目录快速滚动")).toBeHidden();
    await expect(outline.locator(".document-outline-header")).toHaveCSS("height", "37px");
    await page.getByTitle("文档目录").click();

    const bullet = editor.locator("li").first();
    await expect(bullet).toBeVisible();
    await expect.poll(() => bullet.evaluate((element) => getComputedStyle(element).listStyleType))
      .toBe("none");
    const listGeometry = await editor.evaluate((element) => {
      const unordered = element.querySelector(":scope > ul")!;
      const ordered = element.querySelector(":scope > ol")!;
      const orderedItem = ordered.querySelector(":scope > li")!;
      return {
        unorderedPadding: Number.parseFloat(getComputedStyle(unordered).paddingInlineStart),
        orderedPadding: Number.parseFloat(getComputedStyle(ordered).paddingInlineStart),
        orderedMarker: getComputedStyle(orderedItem, "::before").content,
      };
    });
    expect(listGeometry.orderedPadding).toBeCloseTo(listGeometry.unorderedPadding, 1);
    expect(listGeometry.orderedMarker).toContain("counter(list-item)");
    expect(listGeometry.orderedMarker).not.toContain("•");
  });

  test("目录快速滚动按钮显隐不改变标题栏高度", async ({ page }) => {
    await page.goto("/");
    const outlineButton = page.getByTitle("文档目录");
    await outlineButton.click();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await expect(outline.getByLabel("目录快速滚动")).toBeHidden();
    const shortHeaderHeight = await outline.locator(".document-outline-header").evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await outlineButton.click();

    const editor = page.locator(".ProseMirror");
    const initialHeadingCount = await editor.locator("h1, h2, h3, h4, h5, h6").count();
    const extraOutline = Array.from(
      { length: 160 },
      (_, index) => `## 性能章节 ${index + 1}\n\n章节正文 ${index + 1}`,
    ).join("\n\n");
    await editor.click();
    await editor.press("Control+End");
    await editor.evaluate((element, markdown) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", markdown);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, `\n\n${extraOutline}`);
    await expect(editor.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(initialHeadingCount + 160);

    await outlineButton.click();
    await outline.getByTitle("展开全部章节").click();
    await expect(outline.locator(".document-outline-count")).toHaveText(`${initialHeadingCount + 160} 项`);
    await expect.poll(() => outline.locator(".document-outline-item").count()).toBeLessThan(80);
    await expect(outline.getByLabel("目录快速滚动")).toBeVisible();
    const longHeaderHeight = await outline.locator(".document-outline-header").evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(longHeaderHeight).toBe(shortHeaderHeight);
    await outline.getByRole("button", { name: "Bot" }).click();
    await expect(outline.locator(".document-outline-text", { hasText: "性能章节 160" })).toBeVisible();
    const compactRows = outline.locator(".document-outline-item").filter({ hasText: "性能章节" });
    await expect.poll(() => compactRows.count()).toBeGreaterThan(2);
    const compactGeometry = await compactRows.evaluateAll((items) => {
      const rows = items.map((item) => item.getBoundingClientRect()).sort((left, right) => left.top - right.top);
      return {
        heights: rows.map((row) => row.height),
        gaps: rows.slice(1).map((row, index) => row.top - rows[index].top),
      };
    });
    expect(Math.max(...compactGeometry.heights)).toBeLessThanOrEqual(27);
    expect(Math.max(...compactGeometry.gaps)).toBeLessThanOrEqual(28);
  });

  test("专注与普通模式目录同宽且长标题最多显示两行", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const longTitle = "这是一个用于验证手机目录能够尽量完整显示内容而不会过早截断的很长章节标题并继续补充足够多的文字验证第二行显示效果";
    await editor.fill(longTitle);
    const longHeading = editor.locator("h1, h2, h3, h4, h5, h6").filter({ hasText: longTitle });
    await expect(longHeading).toBeVisible();
    await editor.press("Control+End");
    await editor.evaluate((element) => {
      const markdown = Array.from({ length: 105 }, (_, index) => `## 短章节 ${index + 1}\n\n正文 ${index + 1}`)
        .join("\n\n");
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", `\n\n${markdown}`);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(editor.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(106);
    await longHeading.click();

    const normalOutlineButton = page.locator(".note-title-row").getByTitle("文档目录");
    await normalOutlineButton.click();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await outline.getByTitle("展开全部章节").click();
    const longItem = outline.locator(".document-outline-item").filter({ hasText: longTitle });
    await expect(longItem).toBeVisible();
    const normalGeometry = await outline.evaluate((panel) => {
      const item = [...panel.querySelectorAll<HTMLElement>(".document-outline-item")]
        .find((element) => element.textContent?.includes("这是一个用于验证手机目录"));
      if (!item) throw new Error("long outline item not found");
      const text = item.querySelector<HTMLElement>(".document-outline-text")!;
      return {
        width: panel.getBoundingClientRect().width,
        itemHeight: item.getBoundingClientRect().height,
        textWidth: text.getBoundingClientRect().width,
        textScrollWidth: text.scrollWidth,
        whiteSpace: getComputedStyle(text).whiteSpace,
        lineClamp: getComputedStyle(text).webkitLineClamp,
      };
    });
    expect(normalGeometry.width).toBeGreaterThanOrEqual(370);
    expect(normalGeometry.itemHeight, JSON.stringify(normalGeometry)).toBeGreaterThan(38);
    const shortItemHeight = await outline.locator('.document-outline-item[title="短章节 1"]')
      .evaluate((item) => item.getBoundingClientRect().height);
    expect(shortItemHeight).toBeLessThanOrEqual(27);
    await normalOutlineButton.click();

    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const focusOutlineButton = page.getByLabel("专注模式工具栏").getByTitle("文档目录");
    await focusOutlineButton.click();
    const focusWidth = await outline.evaluate((panel) => panel.getBoundingClientRect().width);
    expect(focusWidth).toBeCloseTo(normalGeometry.width, 1);
  });

  test("移动端块编号使用紧凑且可随位数扩展的 gutter", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^编辑器/ }).click();
    const lineNumberSetting = page.locator(".settings-field").filter({ hasText: "显示块编号" });
    await lineNumberSetting.locator(".settings-toggle").click();
    await page.getByLabel("关闭设置").click();

    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "30px");
    const geometry = await page.locator(".editor-content-shell").evaluate((shell) => {
      const number = shell.querySelector(".editor-block-number")!.getBoundingClientRect();
      const paragraph = shell.querySelector(".ProseMirror > *")!.getBoundingClientRect();
      const orderedNumber = shell.querySelector<HTMLElement>('.editor-block-number[data-block-format="OL"]')!.getBoundingClientRect();
      const orderedList = shell.querySelector<HTMLElement>(".ProseMirror > ol")!;
      const orderedItem = orderedList.querySelector<HTMLElement>(":scope > li")!;
      const orderedListRect = orderedList.getBoundingClientRect();
      return {
        shellLeft: shell.getBoundingClientRect().left,
        numberRight: number.right,
        paragraphLeft: paragraph.left,
        orderedNumberRight: orderedNumber.right,
        orderedListLeft: orderedListRect.left,
        orderedItemOffset: orderedItem.getBoundingClientRect().left - orderedListRect.left,
        orderedPadding: Number.parseFloat(getComputedStyle(orderedList).paddingInlineStart),
      };
    });
    expect(geometry.shellLeft).toBeLessThanOrEqual(4.5);
    expect(geometry.paragraphLeft - geometry.numberRight).toBeGreaterThanOrEqual(3.5);
    expect(geometry.orderedNumberRight).toBeLessThanOrEqual(geometry.orderedListLeft);
    expect(geometry.orderedItemOffset).toBeCloseTo(geometry.orderedPadding, 1);
    await expect(page.locator(".editor-block-insert")).toHaveCount(0);
  });

  test("只读文档可从主编辑区直接恢复编辑", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("显示侧栏").click();
    await page.getByTitle("切换到随笔").click();

    const readonlyButton = page.locator(".sidebar-item.active").getByTitle("设为只读");
    await readonlyButton.evaluate((button: HTMLButtonElement) => button.click());
    await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });

    const editor = page.locator(".ProseMirror");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    const restoreEditing = page.getByRole("button", { name: "点击设为可编辑" });
    await expect(restoreEditing).toBeVisible();
    await restoreEditing.click();

    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(restoreEditing).toHaveCount(0);
  });

  test("手机端通过块菜单在当前块后插入空白块", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const blocks = editor.locator(":scope > *");
    await expect(blocks.first()).toBeVisible();
    const initialBlockCount = await blocks.count();
    expect(initialBlockCount).toBeGreaterThan(1);
    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "14px");
    await expect(page.locator(".editor-block-insert")).toHaveCount(0);

    const orderedList = editor.locator(":scope > ol").first();
    await orderedList.locator("li").first().click();
    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: "＋ 在当前块后插入空白块" }).click();
    await page.keyboard.type("手机插入块");

    await expect(blocks).toHaveCount(initialBlockCount + 1);
    await expect(orderedList.locator("xpath=following-sibling::*[1]")).toHaveText("手机插入块");
  });

  test("千块文档不测量非标题 gutter 且延迟快照仍会保存", async ({ page }) => {
    test.slow();
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const content = Array.from({ length: 1200 }, (_, index) => `块 ${index + 1}`).join("\n");
    await editor.fill(content);
    await expect(editor.locator(":scope > *")).toHaveCount(1200);
    // 光标在文末时首个标题处于虚拟窗口外；gutter 不应再为离屏标题
    // 永久保留 DOM。
    expect(await page.locator(".editor-block-gutter .editor-heading-fold").count()).toBeLessThanOrEqual(1);
    const paragraphGeometryReads = await page.evaluate(async () => {
      const original = HTMLElement.prototype.getBoundingClientRect;
      let reads = 0;
      HTMLElement.prototype.getBoundingClientRect = function measuredRect() {
        if (this.tagName === "P" && this.parentElement?.classList.contains("ProseMirror")) reads += 1;
        return original.call(this);
      };
      try {
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        return reads;
      } finally {
        HTMLElement.prototype.getBoundingClientRect = original;
      }
    });
    expect(paragraphGeometryReads).toBeLessThan(20);

    const scrollWork = await page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const originalRect = HTMLElement.prototype.getBoundingClientRect;
      const originalSetItem = Storage.prototype.setItem;
      let paragraphRects = 0;
      let positionWrites = 0;
      HTMLElement.prototype.getBoundingClientRect = function measuredRect() {
        if (this.tagName === "P" && this.parentElement?.classList.contains("ProseMirror")) paragraphRects += 1;
        return originalRect.call(this);
      };
      Storage.prototype.setItem = function measuredSetItem(key: string, value: string) {
        if (key.startsWith("scrollPos:")) positionWrites += 1;
        return originalSetItem.call(this, key, value);
      };
      try {
        const maximum = root.scrollHeight - root.clientHeight;
        // 跨多个绘制帧持续向下再向上，模拟手机惯性滚动。把几十个事件
        // 同步塞进一帧只能验证 rAF 合并，无法发现“每帧都强制布局”的问题。
        for (let step = 1; step <= 36; step += 1) {
          const progress = step <= 24 ? step / 24 : (36 - step) / 12;
          root.scrollTop = maximum * Math.max(0, progress);
          root.dispatchEvent(new Event("scroll"));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        const paragraphRectsDuringScroll = paragraphRects;
        await new Promise((resolve) => window.setTimeout(resolve, 280));
        return { paragraphRects, paragraphRectsDuringScroll, positionWrites };
      } finally {
        HTMLElement.prototype.getBoundingClientRect = originalRect;
        Storage.prototype.setItem = originalSetItem;
      }
    });
    // 每段连续滚动允许起始锚点做一次常数级测量；不能随绘制帧增长。
    expect(scrollWork.paragraphRectsDuringScroll).toBeLessThanOrEqual(6);
    expect(scrollWork.paragraphRects).toBeLessThan(20);
    expect(scrollWork.positionWrites).toBeLessThanOrEqual(2);

    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^编辑器/ }).click();
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.getByLabel("关闭设置").click();
    const gutterNumbers = page.locator(".editor-block-number");
    await expect.poll(() => gutterNumbers.count()).toBeGreaterThan(0);
    expect(await gutterNumbers.count()).toBeLessThan(160);
    await page.locator(".note-editor-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(gutterNumbers.filter({ hasText: /^1200$/ })).toBeVisible();
    expect(await gutterNumbers.count()).toBeLessThan(160);

    const lastBlock = editor.locator(":scope > p").last();
    await lastBlock.click();
    await page.keyboard.press("End");
    const startedAt = Date.now();
    await page.keyboard.type("-连续输入-1234567890");
    expect(Date.now() - startedAt).toBeLessThan(2500);
    await expect(lastBlock).toHaveText("块 1200-连续输入-1234567890");

    await expect(page.getByTitle("已保存")).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.locator(".ProseMirror > p").last()).toHaveText(
      "块 1200-连续输入-1234567890",
      { timeout: 15000 },
    );
  });

  test("专注模式保留极简标题栏并可按需展开编辑工具", async ({ page }) => {
    await page.goto("/");
    const title = await page.locator(".note-title").inputValue();
    await page.getByTitle("专注模式").click();

    await expect(page.locator(".app-header")).toBeHidden();
    const focusBar = page.getByLabel("专注模式工具栏");
    await expect(focusBar).toBeVisible();
    await expect(focusBar).toHaveCSS("backdrop-filter", "none");
    await expect(focusBar.locator(".mobile-focus-title")).toHaveText(title);
    await expect(page.locator(".note-title-row")).toBeHidden();
    await expect(page.locator(".editor-menu")).toBeHidden();

    const focusOutlineButton = focusBar.getByTitle("文档目录");
    await expect(focusOutlineButton).toBeVisible();
    await focusOutlineButton.click();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await expect(outline).toBeVisible();
    const outlineGeometry = await page.locator(".note-editor").evaluate((element) => {
      const focusBarRect = element.querySelector(".mobile-focus-bar")!.getBoundingClientRect();
      const outlineRect = element.querySelector(".document-outline-panel")!.getBoundingClientRect();
      return {
        focusBarBottom: focusBarRect.bottom,
        outlineTop: outlineRect.top,
        outlineRight: outlineRect.right,
        outlineLeft: outlineRect.left,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      };
    });
    expect(outlineGeometry.outlineTop).toBeGreaterThanOrEqual(outlineGeometry.focusBarBottom);
    expect(outlineGeometry.outlineLeft).toBeGreaterThanOrEqual(0);
    expect(outlineGeometry.outlineRight).toBeLessThanOrEqual(outlineGeometry.viewportWidth);
    await focusOutlineButton.click();
    await expect(outline).toHaveCount(0);

    await focusBar.getByTitle("更多编辑工具").click();
    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS("position", "fixed");
    const toolbarGeometry = await page.locator(".note-editor").evaluate((element) => {
      const focusBarRect = element.querySelector(".mobile-focus-bar")!.getBoundingClientRect();
      const toolbarElement = element.querySelector(".editor-menu")!;
      const toolbarRect = toolbarElement.getBoundingClientRect();
      const contentRect = element.querySelector(".editor-content-shell")!.getBoundingClientRect();
      const style = getComputedStyle(toolbarElement);
      return {
        focusBarBottom: focusBarRect.bottom,
        toolbar: { top: toolbarRect.top, right: toolbarRect.right, bottom: toolbarRect.bottom, left: toolbarRect.left },
        contentTop: contentRect.top,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    });
    expect(toolbarGeometry.toolbar.left).toBeGreaterThanOrEqual(0);
    expect(toolbarGeometry.toolbar.right).toBeLessThanOrEqual(toolbarGeometry.viewportWidth);
    expect(toolbarGeometry.toolbar.top).toBeGreaterThanOrEqual(toolbarGeometry.focusBarBottom);
    expect(toolbarGeometry.contentTop).toBeGreaterThanOrEqual(toolbarGeometry.toolbar.bottom);
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

  test("专注模式在竖屏、横屏和桌面均隐藏原始文档标题行", async ({ page }) => {
    await page.goto("/");
    await page.locator(".note-title-row").getByTitle("专注模式").click();

    const titleRow = page.locator(".note-title-row");
    const focusBar = page.getByLabel("专注模式工具栏");
    for (const viewport of [
      { width: 390, height: 760 },
      { width: 760, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(titleRow).toBeHidden();
      await expect(focusBar).toBeVisible();
      await expect(page.locator(".app-header")).toBeHidden();
    }

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(titleRow).toBeHidden();
    await expect(focusBar).toBeHidden();
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".app-header").getByTitle("退出专注模式")).toBeVisible();
  });

  test("更多菜单始终完整限制在手机可视区域内", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("更多编辑操作").click();
    const menu = page.getByRole("dialog", { name: "更多编辑操作" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭更多编辑操作" })).toBeFocused();
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

  test("再次点按更多按钮区域只关闭面板且不会误触导出", async ({ page }) => {
    await page.goto("/");
    let downloadCount = 0;
    page.on("download", () => { downloadCount += 1; });

    const trigger = page.getByTitle("更多编辑操作");
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error("更多按钮不可见");
    await page.touchscreen.tap(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    const sheet = page.getByRole("dialog", { name: "更多编辑操作" });
    await expect(sheet).toBeVisible();

    await page.touchscreen.tap(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(100);
    expect(downloadCount).toBe(0);

    await trigger.click();
    await expect(sheet).toBeVisible();
    await sheet.locator(".mobile-action-sheet-header").evaluate((header) => {
      const rect = header.getBoundingClientRect();
      const touchAt = (clientY: number) => new Touch({
        identifier: 1,
        target: header,
        clientX: rect.left + rect.width / 2,
        clientY,
      });
      const start = touchAt(rect.top + 10);
      const end = touchAt(rect.top + 100);
      header.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start] }));
      header.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [end] }));
      header.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [] }));
    });
    await expect(sheet).toBeHidden();
    expect(downloadCount).toBe(0);
  });

  test("虚拟键盘打开时更多菜单停靠在可视区域底部", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-viewport-height", "460px");
      document.documentElement.style.setProperty("--app-visual-viewport-bottom-inset", "300px");
      document.documentElement.classList.add("web-keyboard-open");
    });

    await page.getByTitle("更多编辑操作").click();
    const sheet = page.getByRole("dialog", { name: "更多编辑操作" });
    const geometry = await sheet.evaluate((menu) => {
      const menuRect = menu.getBoundingClientRect();
      const appRect = document.querySelector(".app")!.getBoundingClientRect();
      return {
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        viewportTop: appRect.top,
        viewportBottom: appRect.bottom,
      };
    });
    expect(geometry.menuTop).toBeGreaterThanOrEqual(geometry.viewportTop);
    expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.viewportBottom);
    await expect(sheet.getByRole("button", { name: /导出 Markdown/ })).toBeVisible();
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

  test("横竖屏往返保持字体比例和当前光标行可见位置", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 90 }, (_, index) => `旋转定位第 ${index + 1} 行`).join("\n"));
    await editor.locator(":scope > *").nth(60).click();
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const selection = window.getSelection()!;
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      root.scrollTop += caret.top - (rootRect.top + rootRect.height * 0.5);
    });
    await page.waitForTimeout(50);

    const readCaretLayout = () => page.evaluate(() => {
      const root = document.querySelector(".note-editor-scroll")!.getBoundingClientRect();
      const editorElement = document.querySelector(".ProseMirror")!;
      const selection = window.getSelection();
      if (!selection?.rangeCount) throw new Error("caret not found");
      const caret = selection.getRangeAt(0).getBoundingClientRect();
      return {
        fontSize: getComputedStyle(editorElement).fontSize,
        textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
        ratio: (caret.top - root.top) / root.height,
        visible: caret.bottom >= root.top + 8 && caret.top <= root.bottom - 20,
      };
    });

    const portraitBefore = await readCaretLayout();
    expect(portraitBefore.textSizeAdjust).toBe("100%");

    await page.setViewportSize({ width: 760, height: 390 });
    await expect.poll(async () => (await readCaretLayout()).visible).toBe(true);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const landscapeAfterPaint = await readCaretLayout();
    expect(landscapeAfterPaint.fontSize).toBe(portraitBefore.fontSize);
    await page.waitForTimeout(420);
    const landscapeSettled = await readCaretLayout();
    expect(Math.abs(landscapeSettled.ratio - landscapeAfterPaint.ratio)).toBeLessThan(0.04);

    await page.setViewportSize({ width: 390, height: 760 });
    await expect.poll(async () => (await readCaretLayout()).visible).toBe(true);
    await expect.poll(async () => {
      const current = await readCaretLayout();
      return Math.abs(current.ratio - portraitBefore.ratio);
    }).toBeLessThan(0.15);
    const portraitAfter = await readCaretLayout();
    expect(portraitAfter.fontSize).toBe(portraitBefore.fontSize);
  });

  test("只读横竖屏往返保持顶部可见块及其偏移", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("显示侧栏").click();
    await page.getByTitle("切换到随笔").click();
    await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 100 }, (_, index) => `阅读定位第 ${index + 1} 块`).join("\n"));
    await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
    await page.locator(".sidebar-item.active").getByTitle("设为只读")
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(editor).toHaveAttribute("contenteditable", "false");

    const target = editor.locator(":scope > p").nth(54);
    await target.evaluate((element) => {
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const rootRect = root.getBoundingClientRect();
      const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
      const stickyRect = sticky?.getBoundingClientRect();
      const visibleTop = sticky && getComputedStyle(sticky).position === "sticky" && stickyRect
        ? Math.max(rootRect.top, Math.min(rootRect.bottom, stickyRect.bottom))
        : rootRect.top;
      root.scrollTop += element.getBoundingClientRect().top - visibleTop - 10;
    });
    await page.waitForTimeout(80);

    const readTopBlock = () => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const rootRect = root.getBoundingClientRect();
      const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky");
      const stickyRect = sticky?.getBoundingClientRect();
      const visibleTop = sticky && getComputedStyle(sticky).position === "sticky" && stickyRect
        ? Math.max(rootRect.top, Math.min(rootRect.bottom, stickyRect.bottom))
        : rootRect.top;
      const block = Array.from(document.querySelectorAll<HTMLElement>(".ProseMirror > *"))
        .find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > visibleTop + 0.5 && rect.top < rootRect.bottom;
        });
      if (!block) throw new Error("top visible block not found");
      return { text: block.textContent, offset: block.getBoundingClientRect().top - visibleTop };
    });

    const portraitBefore = await readTopBlock();
    expect(portraitBefore.text).toMatch(/^阅读定位第 5[4-6] 块$/);

    for (const viewport of [
      { width: 760, height: 390 },
      { width: 390, height: 760 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const current = await readTopBlock();
        return current.text === portraitBefore.text
          && Math.abs(current.offset - portraitBefore.offset) < 20;
      }).toBe(true);
      const afterPaint = await readTopBlock();
      await page.waitForTimeout(420);
      const afterDelayedWindow = await readTopBlock();
      expect(afterDelayedWindow.text).toBe(afterPaint.text);
      expect(Math.abs(afterDelayedWindow.offset - afterPaint.offset)).toBeLessThan(4);
    }
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
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("移动属性面板测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".properties-panel")).toHaveCount(0);
  await page.getByTitle("显示属性面板").click();
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
