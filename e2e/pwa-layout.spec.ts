import { expect, test, type Locator } from "@playwright/test";

async function swipeNoteEditor(
  editor: Locator,
  points: {
    startX: number; startY: number; endX: number; endY: number; durationMs?: number;
    moves?: { x: number; y: number; cancelable?: boolean }[];
    cancel?: boolean;
  },
) {
  return editor.evaluate(async (element, gesture) => {
    const touchAt = (clientX: number, clientY: number) => ({
      identifier: 41,
      target: element,
      clientX,
      clientY,
    });
    const start = touchAt(gesture.startX, gesture.startY);
    const end = touchAt(gesture.endX, gesture.endY);
    // WebKit 不提供可构造的 Touch；通过同样的事件字段覆盖两种浏览器。
    const dispatch = (type: string, touches: typeof start[], changedTouches: typeof start[], cancelable = true) => {
      const event = new Event(type, { bubbles: true, cancelable });
      Object.defineProperties(event, {
        touches: { value: touches },
        changedTouches: { value: changedTouches },
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    dispatch("touchstart", [start], [start]);
    if (gesture.durationMs) await new Promise((resolve) => setTimeout(resolve, gesture.durationMs));
    const prevented = (gesture.moves ?? [{ x: gesture.endX, y: gesture.endY }]).map((point) => {
      const touch = touchAt(point.x, point.y);
      return dispatch("touchmove", [touch], [touch], point.cancelable ?? true);
    });
    dispatch(gesture.cancel ? "touchcancel" : "touchend", [], [end]);
    return prevented;
  }, points);
}

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
    await expect(page.locator(".editor-block-insert").first()).toBeVisible();
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
        fontSize: Number.parseFloat(getComputedStyle(ordered).fontSize),
        orderedOffset: Number.parseFloat(
          getComputedStyle(ordered).getPropertyValue("--editor-ordered-list-offset"),
        ),
        orderedMarker: getComputedStyle(orderedItem, "::before").content,
      };
    });
    expect(listGeometry.orderedPadding - listGeometry.unorderedPadding).toBeCloseTo(
      listGeometry.fontSize * listGeometry.orderedOffset,
      1,
    );
    expect(listGeometry.orderedPadding).toBeGreaterThan(listGeometry.unorderedPadding);
    expect(listGeometry.orderedMarker).toContain("counter(editor-list-item)");
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
    await outline.getByRole("button", { name: "全部展开" }).click();
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

  test("手机目录长标题最多显示两行，点击入口保持浮层宽度", async ({ page }) => {
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
    await outline.getByRole("button", { name: "全部展开" }).click();
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
        textHeight: text.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight),
        textScrollWidth: text.scrollWidth,
        whiteSpace: getComputedStyle(text).whiteSpace,
        lineClamp: getComputedStyle(text).webkitLineClamp,
      };
    });
    expect(normalGeometry.width).toBeGreaterThanOrEqual(370);
    // WebKit 的行高取整可能让两行条目恰好为 38px，按实际文字行高验证换行。
    expect(normalGeometry.textHeight).toBeGreaterThan(normalGeometry.lineHeight * 1.5);
    expect(normalGeometry.textHeight).toBeLessThanOrEqual(normalGeometry.lineHeight * 2 + 1);
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

  test("普通模式目录与书签按钮等高且垂直对齐", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("# 按钮对齐测试\n\n正文");

    const titleRow = page.locator(".note-title-row");
    const outlineButton = titleRow.getByTitle("文档目录");
    const bookmarkButton = titleRow.getByLabel("文档书签");
    await expect(outlineButton).toBeVisible();
    await expect(bookmarkButton).toBeVisible();

    const geometry = await titleRow.evaluate((row) => {
      const outline = row.querySelector<HTMLElement>(".document-outline-toggle")!.getBoundingClientRect();
      const bookmark = row.querySelector<HTMLElement>(".document-bookmark-toggle")!.getBoundingClientRect();
      return {
        outline: { top: outline.top, bottom: outline.bottom, height: outline.height },
        bookmark: { top: bookmark.top, bottom: bookmark.bottom, height: bookmark.height },
      };
    });
    expect(geometry.outline.height).toBeCloseTo(geometry.bookmark.height, 1);
    expect(geometry.outline.top).toBeCloseTo(geometry.bookmark.top, 1);
    expect(geometry.outline.bottom).toBeCloseTo(geometry.bookmark.bottom, 1);
  });

  for (const width of [320, 390, 1280]) {
    test(`非专注模式书签与目录弹层位置一致（${width}px）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const editor = page.locator(".ProseMirror");
      await editor.fill("# 弹层位置测试\n\n正文");
      const titleRow = page.locator(".note-title-row");
      const outlineButton = titleRow.getByRole("button", { name: "文档目录", exact: true });
      const bookmarkButton = titleRow.getByRole("button", { name: "文档书签", exact: true });
      const outline = page.getByRole("navigation", { name: "文档目录" });
      const bookmark = page.getByRole("navigation", { name: "文档书签" });
      const checkPosition = async () => {
        await outlineButton.click();
        await expect(outline).toBeVisible();
        const outlineRect = await outline.boundingBox();
        await bookmarkButton.click();
        await expect(outline).toHaveCount(0);
        await expect(bookmark).toBeVisible();
        await expect(bookmark).toHaveCSS("position", "absolute");
        const bookmarkRect = await bookmark.boundingBox();
        expect(bookmarkRect!.y).toBeCloseTo(outlineRect!.y, 1);
        expect(bookmarkRect!.x + bookmarkRect!.width).toBeCloseTo(outlineRect!.x + outlineRect!.width, 1);
        if (width <= 768) expect(bookmarkRect!.x).toBeCloseTo(outlineRect!.x, 1);
        await bookmarkButton.click();
      };
      await checkPosition();
      await titleRow.getByRole("button", { name: "点击设为只读", exact: true }).click();
      await expect(editor).toHaveAttribute("contenteditable", "false");
      await checkPosition();
      // 可视区域缩小后仍以文档区定位，而不是意外跑到屏幕顶部。
      await page.setViewportSize({ width, height: 480 });
      await checkPosition();
      if (width <= 768) {
        await titleRow.getByTitle("专注模式").click();
        const bar = page.getByLabel("专注模式工具栏");
        await bar.getByRole("button", { name: "文档目录", exact: true }).click();
        const focusOutlineRect = await outline.boundingBox();
        await bar.getByRole("button", { name: "文档书签", exact: true }).click();
        await expect(bookmark).toHaveCSS("position", "fixed");
        const focusBookmarkRect = await bookmark.boundingBox();
        expect(focusBookmarkRect!.y).toBeCloseTo(focusOutlineRect!.y, 1);
        expect(focusBookmarkRect!.x).toBeCloseTo(focusOutlineRect!.x, 1);
      }
    });
  }

  test("点击目录书签使用浮层，右侧滑动使用侧栏，交替打开不串用", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("# 入口区分测试\n\n正文");
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const bar = page.getByLabel("专注模式工具栏");
    const outlineButton = bar.getByRole("button", { name: "文档目录", exact: true });
    const bookmarkButton = bar.getByRole("button", { name: "文档书签", exact: true });
    const outline = page.getByRole("navigation", { name: "文档目录" });
    const bookmark = page.getByRole("navigation", { name: "文档书签" });
    const drawer = page.getByRole("dialog", { name: "阅读侧栏" });
    const host = page.locator(".note-editor");
    const assertPopover = async (panel: Locator) => {
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS("position", "fixed");
      await expect(drawer).toHaveCount(0);
      await expect(page.locator(".mobile-document-drawer")).not.toHaveClass(/is-open/);
      expect((await panel.boundingBox())!.width).toBeGreaterThan(280);
      expect(await panel.evaluate((element) => element.closest(".note-editor") !== null)).toBe(true);
    };
    for (let round = 0; round < 2; round++) {
      await outlineButton.click();
      await assertPopover(outline);
      await bookmarkButton.click();
      await assertPopover(bookmark);
      await expect(outline).toHaveCount(0);
      await bookmarkButton.click();
      await swipeNoteEditor(host, { startX: 370, startY: 190, endX: 270, endY: 200 });
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await expect(drawer.getByRole("navigation", { name: "文档书签" })).toBeVisible();
      await drawer.getByRole("button", { name: "切换到目录" }).click();
      await expect(drawer.getByRole("navigation", { name: "文档目录" })).toBeVisible();
      await page.keyboard.press("Escape");
      // 不等退出动画完成就点按钮，不能留下重复面板或丢失目录 ref。
      await outlineButton.click();
      await assertPopover(outline);
      await expect(page.locator(".mobile-document-drawer .document-outline-panel")).toHaveCount(0);
      await outlineButton.click();
      await swipeNoteEditor(host, { startX: 370, startY: 570, endX: 270, endY: 580 });
      await expect(drawer.getByRole("navigation", { name: "文档目录" })).toBeVisible();
      await drawer.getByRole("button", { name: "切换到书签" }).click();
      await drawer.getByRole("button", { name: "关闭阅读侧栏" }).click();
      await bookmarkButton.click();
      await assertPopover(bookmark);
      await bookmarkButton.click();
    }
  });

  test("手机阅读侧栏与文档树同宽同速，支持遮罩、右划和 Escape 收起", async ({ page }, testInfo) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", Array.from({ length: 35 }, (_, i) => `## 第 ${i + 1} 章\n\n正文`).join("\n\n"));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(editor.locator("h1, h2, h3").filter({ hasText: /^第 \d+ 章$/ })).toHaveCount(35);
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const drawer = page.getByRole("dialog", { name: "阅读侧栏" });
    const host = page.locator(".note-editor");
    const drawerElement = page.locator(".mobile-document-drawer-panel");
    const backdrop = page.locator(".mobile-document-drawer-backdrop");
    const open = async (y: number) => {
      await swipeNoteEditor(host, { startX: 370, startY: y, endX: 270, endY: y + 20 });
      await expect(drawer).toBeVisible();
      await expect(drawerElement).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    };
    await open(570);
    const geometry = await page.evaluate(() => {
      const left = document.querySelector(".app-sidebar")!;
      const right = document.querySelector(".mobile-document-drawer-panel")!;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return {
        leftWidth: leftRect.width, rightWidth: rightRect.width,
        leftHeight: leftRect.height, rightHeight: rightRect.height,
        leftSpeed: getComputedStyle(left).transitionDuration.split(",")[0],
        rightSpeed: getComputedStyle(right).transitionDuration.split(",")[0],
        shade: getComputedStyle(document.querySelector(".mobile-document-drawer-backdrop")!).backgroundColor,
        leftShade: getComputedStyle(document.querySelector(".sidebar-overlay")!).backgroundColor,
      };
    });
    expect(geometry.rightWidth).toBeCloseTo(geometry.leftWidth, 1);
    expect(geometry.rightHeight).toBeCloseTo(geometry.leftHeight, 1);
    expect(geometry.rightSpeed).toBe(geometry.leftSpeed);
    expect(geometry.shade).toBe(geometry.leftShade);
    await page.screenshot({ path: testInfo.outputPath("reading-drawer.png") });
    const outline = drawer.getByRole("navigation", { name: "文档目录" });
    expect(await swipeNoteEditor(outline, { startX: 200, startY: 300, endX: 210, endY: 200 })).toEqual([false]);
    await expect(drawer).toBeVisible();
    // 点击目录条目仍能跳转并收起。
    await outline.locator(".document-outline-link").first().click();
    await expect(drawer).toHaveCount(0);
    await open(570);
    // 从条目文字上右划，只收起侧栏，不误触跳转。
    expect(await swipeNoteEditor(drawer.locator(".document-outline-link").first(), {
      startX: 200, startY: 100, endX: 290, endY: 120,
    })).toEqual([true]);
    await expect(drawer).toHaveCount(0);
    await expect(drawerElement).toHaveCSS("visibility", "hidden");
    await open(190);
    await expect(drawer.getByRole("navigation", { name: "文档书签" })).toBeVisible();
    await drawer.getByRole("button", { name: "切换到目录" }).click();
    await expect(drawer.getByRole("navigation", { name: "文档目录" })).toBeVisible();
    await expect(drawer.getByRole("navigation", { name: "文档书签" })).toHaveCount(0);
    await backdrop.click({ position: { x: 30, y: 380 } });
    await expect(drawer).toHaveCount(0);
    await open(190);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  test("阅读侧栏连续触摸可滚动目录、右划关闭且保留书签行操作", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "连续原生触摸轨迹使用 CDP，WebKit 验证事件和布局回归");
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", Array.from({ length: 60 }, (_, i) => `## 标题 ${i + 1}\n\n正文`).join("\n\n"));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await editor.press("Control+Home");
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const body = page.locator(".note-editor-scroll");
    await body.evaluate((element) => { element.scrollTop = 500; });
    const drawer = page.getByRole("dialog", { name: "阅读侧栏" });
    await swipeNoteEditor(page.locator(".note-editor"), { startX: 370, startY: 570, endX: 270, endY: 580 });
    await expect(drawer).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    const list = drawer.locator(".document-outline-list");
    await list.evaluate((element) => { element.scrollTop = 0; });
    const session = await page.context().newCDPSession(page);
    const swipe = async (x: number, y: number, dx: number, dy: number) => {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 10; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{ x: x + dx * step / 10, y: y + dy * step / 10 }],
        });
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(250, 500, -5, -200);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(500);
    await swipe(190, 300, 100, 12);
    await expect(drawer).toHaveCount(0);
    expect(await body.evaluate((element) => element.scrollTop)).toBe(500);
    await swipeNoteEditor(page.locator(".note-editor"), { startX: 370, startY: 190, endX: 270, endY: 200 });
    await drawer.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
    const row = drawer.locator(".document-bookmark-item");
    const rect = (await row.boundingBox())!;
    await swipe(rect.x + rect.width - 20, rect.y + rect.height / 2, -100, 0);
    await expect(row).toHaveClass(/swipe-open/);
    await swipe(rect.x + 20, rect.y + rect.height / 2, 100, 0);
    await expect(row).not.toHaveClass(/swipe-open/);
    await expect(drawer).toBeVisible();
    await swipe(rect.x + 20, rect.y + rect.height / 2, 100, 0);
    await expect(drawer).toHaveCount(0);
    await session.detach();
  });

  test("专注模式右侧近边缘左划按上下区域打开书签和目录", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("# 边缘手势目录\n\n用于验证右侧分区手势的正文");
    await expect(editor.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(1);
    const noteEditor = page.locator(".note-editor");
    const bookmarkPanel = page.getByRole("navigation", { name: "文档书签" });
    const outlinePanel = page.getByRole("navigation", { name: "文档目录" });

    // 普通模式与距离右边缘过远的左划都不应占用该手势。
    await swipeNoteEditor(noteEditor, { startX: 366, startY: 190, endX: 286, endY: 190 });
    await expect(bookmarkPanel).toHaveCount(0);
    await page.locator(".note-title-row").getByTitle("专注模式").click();

    // 左侧近边缘右划仍交给 App 打开文档树，不被右侧分区手势占用。
    const sidebar = page.locator(".app-sidebar");
    await expect(sidebar).toHaveClass(/sidebar-hidden/);
    await swipeNoteEditor(noteEditor, { startX: 20, startY: 380, endX: 100, endY: 380 });
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await page.locator(".sidebar-overlay.active").click({ position: { x: 350, y: 380 } });
    await expect(sidebar).toHaveClass(/sidebar-hidden/);

    await swipeNoteEditor(noteEditor, { startX: 320, startY: 190, endX: 240, endY: 190 });
    await expect(bookmarkPanel).toHaveCount(0);
    await expect(outlinePanel).toHaveCount(0);

    // 390px 视口中从 x=366 起划，距离右边缘 24px，位于近边缘有效区。
    await swipeNoteEditor(noteEditor, { startX: 366, startY: 190, endX: 286, endY: 190 });
    await expect(bookmarkPanel).toBeVisible();
    await expect(outlinePanel).toHaveCount(0);

    await swipeNoteEditor(noteEditor, { startX: 366, startY: 570, endX: 286, endY: 570 });
    await expect(bookmarkPanel).toHaveCount(0);
    await expect(outlinePanel).toBeVisible();

    await editor.fill("没有标题时目录手势不应打开空面板");
    await editor.press("Control+Alt+0");
    await expect(editor.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(0);
    await expect(outlinePanel).toHaveCount(0);
    await swipeNoteEditor(noteEditor, { startX: 366, startY: 570, endX: 286, endY: 570 });
    await expect(outlinePanel).toHaveCount(0);
    await expect(bookmarkPanel).toHaveCount(0);

    await swipeNoteEditor(noteEditor, { startX: 366, startY: 190, endX: 286, endY: 190 });
    await expect(outlinePanel).toHaveCount(0);
    await expect(bookmarkPanel).toBeVisible();
  });

  test("左右边缘采用相同的距离方向判定并允许慢划", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const host = page.locator(".note-editor");
    const sidebar = page.locator(".app-sidebar");
    const bookmarks = page.getByRole("navigation", { name: "文档书签" });
    const cases = [
      { inset: 1, dx: 80, dy: 0, opens: true },
      { inset: 29, dx: 80, dy: 0, opens: true },
      { inset: 30, dx: 80, dy: 0, opens: false },
      { inset: 40, dx: 80, dy: 0, opens: false },
      { inset: 24, dx: 60, dy: 0, opens: false },
      { inset: 24, dx: 61, dy: 0, opens: true },
      { inset: 24, dx: 100, dy: 80, opens: true },
      { inset: 24, dx: 80, dy: 100, opens: false },
      { inset: 24, dx: 80, dy: 0, durationMs: 1100, opens: true },
    ];
    for (const side of ["left", "right"]) {
      for (const sample of cases) {
        const startX = side === "left" ? sample.inset : 390 - sample.inset;
        await swipeNoteEditor(host, {
          startX, startY: 190,
          endX: startX + (side === "left" ? sample.dx : -sample.dx),
          endY: 190 + sample.dy,
          durationMs: sample.durationMs,
        });
        if (side === "left") {
          if (sample.opens) {
            await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
            await page.locator(".sidebar-overlay.active").click({ position: { x: 350, y: 380 } });
          }
          await expect(sidebar).toHaveClass(/sidebar-hidden/);
        } else {
          if (sample.opens) {
            await expect(bookmarks).toBeVisible();
            await page.getByRole("button", { name: "关闭阅读侧栏" }).click();
          }
          await expect(bookmarks).toHaveCount(0);
        }
      }
    }
  });

  test("边缘滑动提前锁定方向，纵向滚动和取消后不再打开面板", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const host = page.locator(".note-editor");
    const sidebar = page.locator(".app-sidebar");
    const bookmarks = page.getByRole("navigation", { name: "文档书签" });
    for (const side of ["left", "right"]) {
      const startX = side === "left" ? 20 : 370;
      const sign = side === "left" ? 1 : -1;
      const close = async () => {
        if (side === "left") {
          await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
          expect(await swipeNoteEditor(sidebar, {
            startX: 200, startY: 190, endX: 100, endY: 210,
          })).toEqual([true]);
          await expect(sidebar).toHaveClass(/sidebar-hidden/);
        } else {
          await expect(bookmarks).toBeVisible();
          await page.getByRole("button", { name: "关闭阅读侧栏" }).click();
        }
      };
      // 尚未达到打开面板的距离时，就必须阻止竖直漂移；锁定后不换轴。
      expect(await swipeNoteEditor(host, {
        startX, startY: 190, endX: startX + sign * 80, endY: 310,
        moves: [{ x: startX + sign * 8, y: 193 }, { x: startX + sign * 80, y: 310 }],
      })).toEqual([true, true]);
      await close();
      for (const scenario of ["vertical", "cancel", "noncancelable", "short", "reverse"]) {
        const first = scenario === "vertical" ? { x: startX + sign * 3, y: 200 }
          : scenario === "reverse" ? { x: startX - sign * 8, y: 193 }
          : { x: startX + sign * 8, y: 193, cancelable: scenario !== "noncancelable" };
        const endX = startX + sign * (scenario === "short" ? 30 : 80);
        const prevented = await swipeNoteEditor(host, {
          startX, startY: 190, endX, endY: 200,
          moves: [first, { x: endX, y: 200 }], cancel: scenario === "cancel",
        });
        expect(prevented).toEqual(scenario === "cancel" || scenario === "short" ? [true, true] : [false, false]);
        await expect(sidebar).toHaveClass(/sidebar-hidden/);
        await expect(bookmarks).toHaveCount(0);
      }
    }
  });

  test("边缘横划不会带动长文滚动，纵划仍能正常阅读", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "真实触摸轨迹使用 Chromium CDP；WebKit 在事件回归中验证取消默认滚动");
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 100 }, (_, i) => `正文第 ${i + 1} 段，用于验证滑动时的位置稳定。`).join("\n\n"));
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await editor.evaluate((element) => { (element as HTMLElement).blur(); window.getSelection()?.removeAllRanges(); });
    const scroller = page.locator(".note-editor-scroll");
    const session = await page.context().newCDPSession(page);
    const swipe = async (x: number, dx: number, dy: number) => {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: 320 }] });
      for (let step = 1; step <= 10; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{ x: x + dx * step / 10, y: 320 + dy * step / 10 }],
        });
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    for (const side of ["left", "right"]) {
      await scroller.evaluate((element) => { element.scrollTop = 500; });
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(500);
      await swipe(side === "left" ? 20 : 370, side === "left" ? 100 : -100, -70);
      if (side === "left") {
        await expect(page.locator(".app-sidebar")).not.toHaveClass(/sidebar-hidden/);
        await page.locator(".sidebar-overlay.active").click({ position: { x: 350, y: 380 } });
      } else {
        await expect(page.getByRole("navigation", { name: "文档书签" })).toBeVisible();
        await page.getByRole("button", { name: "关闭阅读侧栏" }).click();
      }
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(500);
    }
    await swipe(370, -10, -140);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(550);
    await expect(page.getByRole("navigation", { name: "文档书签" })).toHaveCount(0);
    await session.detach();
  });

  test("边缘手势不会抢占按钮和已选中的文本", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("需要保留的文本选择");
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    const host = page.locator(".note-editor");
    const button = page.locator(".mobile-focus-bar").getByRole("button", { name: "文档书签", exact: true });
    for (const startX of [20, 370]) {
      const points = { startX, startY: 190, endX: startX === 20 ? 100 : 290, endY: 200 };
      expect(await swipeNoteEditor(button, points)).toEqual([false]);
      await editor.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      expect(await swipeNoteEditor(host, points)).toEqual([false]);
      await editor.evaluate(() => window.getSelection()?.removeAllRanges());
      await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
      await expect(page.getByRole("navigation", { name: "文档书签" })).toHaveCount(0);
    }
  });

  test("左右边缘从编辑器外起划也一致，遮罩支持反向关闭并阻止竖向滚动", async ({ page }) => {
    await page.goto("/");
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    // The app shell, unlike the old right-side listener, is not inside NoteEditor.
    const host = page.locator(".app-main");
    for (const side of ["left", "right"] as const) {
      const panel = side === "left" ? page.getByRole("dialog", { name: "文档侧栏" }) : page.getByRole("dialog", { name: "阅读侧栏" });
      const backdrop = page.locator(side === "left" ? ".sidebar-overlay.active" : ".mobile-document-drawer-backdrop");
      await swipeNoteEditor(host, {
        startX: side === "left" ? 20 : 370, startY: 190,
        endX: side === "left" ? 100 : 290, endY: 200,
      });
      await expect(panel).toBeVisible();
      await expect(panel.locator("[data-drawer-close]")).toBeFocused();
      const x = side === "left" ? 350 : 40;
      expect(await swipeNoteEditor(backdrop, { startX: x, startY: 380, endX: x, endY: 280 })).toEqual([true]);
      await expect(panel).toBeVisible();
      expect(await swipeNoteEditor(backdrop, { startX: x, startY: 380, endX: x + (side === "left" ? -90 : 90), endY: 390 })).toEqual([true]);
      await expect(panel).toHaveCount(0);
    }
  });

  test("左右侧栏使用同一可视视口坐标和减少动画设置", async ({ page }) => {
    await page.goto("/");
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      for (const [name, value] of Object.entries({ offsetLeft: 25, offsetTop: 20, width: 340, height: 600 })) {
        Object.defineProperty(viewport, name, { configurable: true, value });
      }
      const style = document.documentElement.style;
      style.setProperty("--app-visual-viewport-offset-left", "25px");
      style.setProperty("--app-visual-viewport-offset-top", "20px");
      style.setProperty("--app-viewport-width", "340px");
      style.setProperty("--app-viewport-height", "600px");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const host = page.locator(".app-main");
    await swipeNoteEditor(host, { startX: 26, startY: 330, endX: 110, endY: 335 });
    const left = page.getByRole("dialog", { name: "文档侧栏" });
    await expect(left).toBeVisible();
    const leftRect = await left.boundingBox();
    expect(await left.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
    await page.keyboard.press("Escape");
    await swipeNoteEditor(host, { startX: 364, startY: 330, endX: 280, endY: 335 });
    const right = page.getByRole("dialog", { name: "阅读侧栏" });
    await expect(right.getByRole("navigation", { name: "文档目录" })).toBeVisible();
    expect(await right.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
    const rightRect = await right.boundingBox();
    expect(rightRect!.y).toBe(leftRect!.y);
    expect(rightRect!.height).toBe(leftRect!.height);
    expect(rightRect!.width).toBe(leftRect!.width);
    expect(leftRect!.x).toBe(25);
    expect(rightRect!.x + rightRect!.width).toBe(365);
  });

  test("移动端块编号使用紧凑且可随位数扩展的 gutter", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^外观与排版/ }).click();
    await page.getByRole("button", { name: /^编辑器设置/ }).click();
    const lineNumberSetting = page.locator(".settings-field").filter({ hasText: "显示块编号" });
    await lineNumberSetting.locator(".settings-toggle").click();
    await page.getByLabel("关闭设置").click();

    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "38px");
    const geometry = await page.locator(".editor-content-shell").evaluate((shell) => {
      const number = shell.querySelector(".editor-block-number")!.getBoundingClientRect();
      const paragraph = shell.querySelector(".ProseMirror > *")!.getBoundingClientRect();
      const orderedNumber = shell.querySelector<HTMLElement>('.editor-block-number[data-block-format="OL"]')!.getBoundingClientRect();
      const orderedList = shell.querySelector<HTMLElement>(".ProseMirror > ol")!;
      const orderedItem = orderedList.querySelector<HTMLElement>(":scope > li")!;
      const orderedListRect = orderedList.getBoundingClientRect();
      const insert = shell.querySelector<HTMLElement>(".editor-block-insert")!.getBoundingClientRect();
      return {
        shellLeft: shell.getBoundingClientRect().left,
        insertRight: insert.right,
        numberLeft: number.left,
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
    expect(geometry.insertRight).toBeLessThanOrEqual(geometry.numberLeft);
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
    const setReadonly = page.getByRole("button", { name: "点击设为只读" });
    await expect(setReadonly).toBeVisible();
    await expect(setReadonly).toHaveText("🔓");
    await setReadonly.click();
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(restoreEditing).toBeVisible();
    await expect(restoreEditing).toHaveText("🔒");
    const readonlyNotice = page.locator(".readonly-change-notice");
    await expect(readonlyNotice).toBeVisible();
    await expect(readonlyNotice).toHaveCSS("position", "absolute");
    const contentTopWhileNoticeVisible = await page.locator(".editor-content-shell")
      .evaluate((element) => element.getBoundingClientRect().top);
    await expect(readonlyNotice).toHaveCount(0, { timeout: 4000 });
    const contentTopAfterNotice = await page.locator(".editor-content-shell")
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(contentTopAfterNotice - contentTopWhileNoticeVisible)).toBeLessThanOrEqual(1);
  });

  for (const width of [320, 390, 1280]) {
    test(`只读切换提示固定在标题行且不遮挡操作按钮（${width}px）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const editor = page.locator(".ProseMirror");
      await expect(editor).toBeVisible();
      const titleRow = page.locator(".note-title-row");
      const title = titleRow.locator(".note-title");
      await title.fill("用于验证标题区域不被提示挤压的较长文档名称");
      const before = await titleRow.boundingBox();
      const titleBefore = await title.boundingBox();
      await titleRow.getByRole("button", { name: "点击设为只读", exact: true }).click();
      await expect(editor).toHaveAttribute("contenteditable", "false");
      await expect(page.locator(".editor-menu")).toBeHidden();
      const notice = titleRow.getByRole("status");
      await expect(notice).toHaveText("已设置为只读");
      await expect(notice).toHaveCSS("pointer-events", "none");
      const geometry = await titleRow.evaluate((row) => {
        const field = row.querySelector(".note-title-field")!.getBoundingClientRect();
        const notice = row.querySelector(".readonly-change-notice")!.getBoundingClientRect();
        const rect = row.getBoundingClientRect();
        const buttons = Array.from(row.querySelectorAll("button"), (button) => button.getBoundingClientRect());
        return {
          top: notice.top, bottom: notice.bottom, centerY: (notice.top + notice.bottom) / 2,
          rowTop: rect.top, rowBottom: rect.bottom,
          contained: notice.left >= field.left && notice.right <= field.right,
          overlapsButton: buttons.some((button) => notice.left < button.right && notice.right > button.left),
          clickThrough: document.elementFromPoint((notice.left + notice.right) / 2, (notice.top + notice.bottom) / 2)?.classList.contains("note-title"),
        };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.rowTop);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.rowBottom);
      expect(geometry.contained).toBe(true);
      expect(geometry.overlapsButton).toBe(false);
      expect(geometry.clickThrough).toBe(true);
      expect((await titleRow.boundingBox())!.height).toBeCloseTo(before!.height, 1);
      expect((await title.boundingBox())!.width).toBeCloseTo(titleBefore!.width, 1);

      await titleRow.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
      await expect(editor).toHaveAttribute("contenteditable", "true");
      await expect(page.locator(".editor-menu")).toBeVisible();
      await expect(notice).toHaveText("已设置为可编辑");
      const editableRect = await notice.boundingBox();
      expect(editableRect!.y + editableRect!.height / 2).toBeCloseTo(geometry.centerY, 1);
      const contentTop = await page.locator(".editor-content-shell").evaluate((element) => element.getBoundingClientRect().top);
      await expect(notice).toHaveCount(0, { timeout: 4000 });
      expect((await titleRow.boundingBox())!.height).toBeCloseTo(before!.height, 1);
      expect(await page.locator(".editor-content-shell").evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(contentTop, 1);
    });
  }

  test("手机端通过块菜单在当前块后插入空白块", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const blocks = editor.locator(":scope > *");
    await expect(blocks.first()).toBeVisible();
    const initialBlockCount = await blocks.count();
    expect(initialBlockCount).toBeGreaterThan(1);
    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "22px");
    await expect(page.locator(".editor-block-insert").first()).toBeVisible();

    const orderedList = editor.locator(":scope > ol").first();
    await orderedList.locator("li").first().click();
    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: "＋ 在当前块后插入空白块" }).click();
    await page.keyboard.type("手机插入块");

    await expect(blocks).toHaveCount(initialBlockCount + 1);
    await expect(orderedList.locator("xpath=following-sibling::*[1]")).toHaveText("手机插入块");
  });

  test("手机端可稳定点按 gutter 加号且编辑区避开 splitter 热区", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    const blocks = editor.locator(":scope > *");
    const initialBlockCount = await blocks.count();

    const separation = await page.evaluate(() => {
      const divider = document.querySelector<HTMLElement>(".app-main-divider")!.getBoundingClientRect();
      const sticky = document.querySelector<HTMLElement>(".note-editor-sticky")!.getBoundingClientRect();
      const firstInsert = document.querySelector<HTMLElement>('.editor-block-insert[aria-label="在第一块前插入段落"]')!.getBoundingClientRect();
      return {
        splitterToEditor: sticky.top - divider.bottom,
        stickyToFirstInsert: firstInsert.top - sticky.bottom,
      };
    });
    expect(separation.splitterToEditor).toBeGreaterThanOrEqual(9.5);
    expect(separation.stickyToFirstInsert).toBeGreaterThanOrEqual(3.5);

    const insertAfterFirst = page.getByRole("button", { name: "在第 1 块后插入段落" });
    await expect(insertAfterFirst).toBeVisible();
    const insertBox = await insertAfterFirst.boundingBox();
    if (!insertBox) throw new Error("mobile gutter insert button geometry not found");
    await page.touchscreen.tap(
      insertBox.x + insertBox.width / 2,
      insertBox.y + insertBox.height / 2,
    );
    await page.keyboard.type("手机就地插入");

    await expect(blocks).toHaveCount(initialBlockCount + 1);
    await expect(blocks.nth(1)).toHaveText("手机就地插入");
  });

  test("待办输入框与 splitter 留出间距且输入框底部可点按", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");
    for (const viewport of [{ width: 390, height: 760 }, { width: 1200, height: 800 }]) {
      await page.setViewportSize(viewport);
      const input = page.locator(".todo-input");
      await expect(input).toBeVisible();
      const geometry = await input.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const divider = document.querySelector<HTMLElement>(".app-main-divider")!.getBoundingClientRect();
        return {
          gap: divider.top - rect.bottom,
          bottomIsInteractive: document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 1) === element,
        };
      });
      expect(geometry.gap).toBeGreaterThanOrEqual(12);
      expect(geometry.bottomIsInteractive).toBe(true);
    }
  });

  test("手机向上拖动 splitter 不会选中待办输入框", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");

    const todoInput = page.locator(".todo-input");
    const divider = page.locator(".app-main-divider");
    await todoInput.fill("不会因拖动被选中");
    await expect(todoInput).toBeFocused();

    const dragState = await divider.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const makePointer = (type: string, clientY: number) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 73,
        pointerType: "touch",
        isPrimary: true,
        clientX: rect.left + rect.width / 2,
        clientY,
      });
      const startY = rect.top + rect.height / 2;
      const startAllowed = element.dispatchEvent(makePointer("pointerdown", startY));
      const input = document.querySelector<HTMLInputElement>(".todo-input")!;
      const during = {
        bodyDragging: document.body.classList.contains("app-split-dragging"),
        inputFocused: document.activeElement === input,
        inputUserSelect: getComputedStyle(input).webkitUserSelect,
      };
      element.dispatchEvent(makePointer("pointermove", startY - 80));
      element.dispatchEvent(makePointer("pointerup", startY - 80));
      return {
        startAllowed,
        during,
        bodyDraggingAfterEnd: document.body.classList.contains("app-split-dragging"),
      };
    });

    expect(dragState.startAllowed).toBe(false);
    expect(dragState.during).toEqual({
      bodyDragging: true,
      inputFocused: false,
      inputUserSelect: "none",
    });
    expect(dragState.bodyDraggingAfterEnd).toBe(false);
    await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("nr:todoSplit"))))
      .toBeLessThan(3);
  });

  test("宽屏触控设备通过待办操作面板编辑和删除", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");

    const todoInput = page.locator(".todo-input");
    await todoInput.fill("触屏待办操作");
    await todoInput.press("Enter");
    const todo = page.locator(".todo-item").filter({ hasText: "触屏待办操作" });
    const more = todo.getByRole("button", { name: "更多待办操作 触屏待办操作" });
    await expect(more).toBeVisible();
    await expect(todo.locator(".todo-remove")).toBeHidden();

    await more.click();
    const sheet = page.getByRole("dialog", { name: "待办：触屏待办操作" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "✎ 编辑文本" }).click();
    const editInput = page.locator(".todo-edit-input");
    await expect(editInput).toBeFocused();
    await editInput.fill("触屏待办已编辑");
    await editInput.press("Enter");
    const editedTodo = page.locator(".todo-item").filter({ hasText: "触屏待办已编辑" });
    await expect(editedTodo).toBeVisible();

    await editedTodo.getByRole("button", { name: "更多待办操作 触屏待办已编辑" }).click();
    await page.getByRole("dialog", { name: "待办：触屏待办已编辑" })
      .getByRole("button", { name: "🗑 删除" })
      .click();
    await expect(editedTodo).toHaveCount(0);
  });

  test("宽屏触控设备拖动侧栏 splitter 不会触发页面选择", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.addInitScript(() => {
      localStorage.setItem("nr:sidebarHidden", "false");
      localStorage.setItem("nr:sidebarW", "240");
    });
    await page.goto("/");

    const divider = page.locator(".sidebar-divider");
    await expect(divider).toBeVisible();
    const dragState = await divider.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const pointer = (type: string, clientX: number) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 91,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX,
        clientY: rect.top + rect.height / 2,
      });
      const startX = rect.left + rect.width / 2;
      const startAllowed = element.dispatchEvent(pointer("pointerdown", startX));
      const userSelectDuring = document.body.style.webkitUserSelect;
      element.dispatchEvent(pointer("pointermove", startX + 60));
      element.dispatchEvent(pointer("pointerup", startX + 60));
      return {
        startAllowed,
        userSelectDuring,
        userSelectAfter: document.body.style.webkitUserSelect,
      };
    });

    expect(dragState).toEqual({
      startAllowed: false,
      userSelectDuring: "none",
      userSelectAfter: "",
    });
    await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("nr:sidebarW"))))
      .toBe(300);
  });

  test("千块文档仅测量视口附近 gutter 且延迟快照仍会保存", async ({ page }) => {
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
      const scrollRoot = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
      // Tail-fold recovery remeasures the observed candidate window, including
      // 20 preloaded blocks on each side, not only the current IO intersections.
      // Bound work by viewport size rather than an obsolete fixed 20-read cap.
      const budget = Math.ceil(scrollRoot.clientHeight / lineHeight) + 2 * 20 + 4;
      const original = HTMLElement.prototype.getBoundingClientRect;
      let reads = 0;
      HTMLElement.prototype.getBoundingClientRect = function measuredRect() {
        if (this.tagName === "P" && this.parentElement?.classList.contains("ProseMirror")) reads += 1;
        return original.call(this);
      };
      try {
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        return { reads, budget };
      } finally {
        HTMLElement.prototype.getBoundingClientRect = original;
      }
    });
    expect(paragraphGeometryReads.reads).toBeLessThanOrEqual(paragraphGeometryReads.budget);

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
    // 起始锚点为常数级测量；划过文末留白时，尾部折叠修复还允许一次
    // 二分查找恢复窗口（基线版本同样会发生），预算不随滚动帧数增长。
    const blankTailSearchBudget = Math.ceil(Math.log2(1200));
    expect(scrollWork.paragraphRectsDuringScroll).toBeLessThanOrEqual(6 + blankTailSearchBudget);
    expect(scrollWork.paragraphRects).toBeLessThan(20);
    expect(scrollWork.positionWrites).toBeLessThanOrEqual(2);

    await page.evaluate(() => {
      const monitoredWindow = window as typeof window & {
        __gutterObserveCount?: number;
        __gutterObserveOriginal?: IntersectionObserver["observe"];
      };
      const original = IntersectionObserver.prototype.observe;
      monitoredWindow.__gutterObserveCount = 0;
      monitoredWindow.__gutterObserveOriginal = original;
      IntersectionObserver.prototype.observe = function observe(target: Element) {
        if (target.parentElement?.classList.contains("ProseMirror")) {
          monitoredWindow.__gutterObserveCount = (monitoredWindow.__gutterObserveCount ?? 0) + 1;
        }
        return original.call(this, target);
      };
    });
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^外观与排版/ }).click();
    await page.getByRole("button", { name: /^编辑器设置/ }).click();
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.getByLabel("关闭设置").click();
    const gutterNumbers = page.locator(".editor-block-number");
    await expect.poll(() => gutterNumbers.count()).toBeGreaterThan(0);
    expect(await gutterNumbers.count()).toBeLessThan(160);
    const initiallyObservedBlocks = await page.evaluate(() => {
      const monitoredWindow = window as typeof window & {
        __gutterObserveCount?: number;
        __gutterObserveOriginal?: IntersectionObserver["observe"];
      };
      const count = monitoredWindow.__gutterObserveCount ?? 0;
      if (monitoredWindow.__gutterObserveOriginal) {
        IntersectionObserver.prototype.observe = monitoredWindow.__gutterObserveOriginal;
      }
      return count;
    });
    expect(initiallyObservedBlocks).toBeLessThan(180);
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

    await expect(page.getByTitle("未保存")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTitle("已保存")).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.locator(".ProseMirror > p").last()).toHaveText(
      "块 1200-连续输入-1234567890",
      { timeout: 30000 },
    );
  });

  test("专注模式保留极简标题栏并可按需展开编辑工具", async ({ page }) => {
    await page.goto("/");
    const title = "阅读与思考：在专注模式中查看这份较长的文档标题";
    await page.locator(".note-title").fill(title);
    await page.getByTitle("专注模式").click();

    await expect(page.locator(".app-header")).toBeHidden();
    const focusBar = page.getByLabel("专注模式工具栏");
    await expect(focusBar).toBeVisible();
    await expect(focusBar).toHaveCSS("backdrop-filter", "none");
    const focusTitle = focusBar.locator(".mobile-focus-title");
    await expect(focusTitle).toHaveText(title);
    await expect(focusTitle).toHaveCSS("font-size", "16px");
    await expect(focusBar).toHaveCSS("height", "30px");
    await expect(page.locator(".note-title-row")).toBeHidden();
    await expect(page.locator(".editor-menu")).toBeHidden();

    const initialContentGeometry = await page.locator(".note-editor").evaluate((element) => {
      const focusBarRect = element.querySelector(".mobile-focus-bar")!.getBoundingClientRect();
      const firstBlockRect = element.querySelector(".ProseMirror > :first-child")!.getBoundingClientRect();
      return { focusBarBottom: focusBarRect.bottom, firstBlockTop: firstBlockRect.top };
    });
    expect(initialContentGeometry.firstBlockTop).toBeGreaterThanOrEqual(initialContentGeometry.focusBarBottom);
    // 为首个 24px gutter 加号的上半部预留空间后，正文仍保持紧凑。
    expect(initialContentGeometry.firstBlockTop - initialContentGeometry.focusBarBottom).toBeLessThanOrEqual(40);

    const focusOutlineButton = focusBar.getByTitle("文档目录");
    const focusBookmarkButton = focusBar.getByLabel(/文档书签/);
    const focusMoreButton = focusBar.getByTitle("更多编辑工具");
    const focusExitButton = focusBar.getByTitle("退出专注模式");
    for (const button of [focusOutlineButton, focusBookmarkButton, focusMoreButton, focusExitButton]) {
      await expect(button.locator("svg")).toBeVisible();
    }
    const barBefore = await focusBar.boundingBox();
    const bookmarkBefore = await focusBookmarkButton.boundingBox();
    await focusTitle.tap();
    await expect(page.getByRole("tooltip")).toHaveText(title);
    expect(await focusBar.boundingBox()).toEqual(barBefore);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(focusTitle).toBeFocused();
    await focusTitle.tap();
    const focusButtonOrder = await focusBar.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("title")),
    );
    expect(focusButtonOrder.indexOf("更多编辑工具")).toBeLessThan(focusButtonOrder.indexOf("退出专注模式"));
    await focusBookmarkButton.click();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    const bookmarkPanel = page.getByRole("navigation", { name: "文档书签" });
    await expect(bookmarkPanel).toBeVisible();
    await bookmarkPanel.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
    await expect(focusBookmarkButton.locator(".focus-bookmark-count")).toHaveText("1");
    expect(await focusBookmarkButton.boundingBox()).toEqual(bookmarkBefore);
    expect(await focusBar.boundingBox()).toEqual(barBefore);
    await expect(focusOutlineButton).toBeVisible();
    await focusOutlineButton.click();
    await expect(bookmarkPanel).toHaveCount(0);
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await expect(outline).toBeVisible();
    const outlineGeometry = await page.evaluate(() => {
      const focusBarRect = document.querySelector(".mobile-focus-bar")!.getBoundingClientRect();
      const outlineRect = document.querySelector(".note-editor .document-outline-panel")!.getBoundingClientRect();
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

  test("专注模式隐藏待办输入框并在退出后恢复", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");

    const todoInput = page.locator(".todo-input");
    await expect(todoInput).toBeVisible();
    await todoInput.fill("退出专注后继续输入");

    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await expect(todoInput).toBeHidden();
    await expect(todoInput).toHaveValue("退出专注后继续输入");

    await page.getByLabel("专注模式工具栏").getByTitle("退出专注模式").click();
    await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
    await expect(todoInput).toBeVisible();
    await expect(todoInput).toHaveValue("退出专注后继续输入");
  });

  test("专注模式首个 gutter 加号完整避开固定标题栏并可触摸", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    const blocks = editor.locator(":scope > *");
    const initialBlockCount = await blocks.count();

    await page.getByTitle("专注模式").click();
    const focusBar = page.getByLabel("专注模式工具栏");
    const insertBeforeFirst = page.getByRole("button", { name: "在第一块前插入段落" });
    await expect(focusBar).toBeVisible();
    await expect(insertBeforeFirst).toBeVisible();

    const geometry = await page.locator(".note-editor").evaluate((element) => {
      const bar = element.querySelector<HTMLElement>(".mobile-focus-bar")!.getBoundingClientRect();
      const insert = element.querySelector<HTMLElement>('.editor-block-insert[aria-label="在第一块前插入段落"]')!.getBoundingClientRect();
      const firstBlock = element.querySelector<HTMLElement>(".ProseMirror > *")!.getBoundingClientRect();
      return { barBottom: bar.bottom, insertTop: insert.top, firstBlockTop: firstBlock.top };
    });
    expect(geometry.insertTop).toBeGreaterThanOrEqual(geometry.barBottom + 5);
    expect(geometry.firstBlockTop - geometry.barBottom).toBeLessThanOrEqual(24);

    const insertBox = await insertBeforeFirst.boundingBox();
    if (!insertBox) throw new Error("focus mode first gutter insert button geometry not found");
    await page.touchscreen.tap(
      insertBox.x + insertBox.width / 2,
      insertBox.y + insertBox.height / 2,
    );
    await page.keyboard.type("专注模式首块");

    await expect(blocks).toHaveCount(initialBlockCount + 1);
    await expect(blocks.first()).toHaveText("专注模式首块");
  });

  test("随笔模板选择器在移动侧栏中完整显示", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("显示侧栏").click();
    await page.getByTitle("切换到随笔").click();
    await page.getByTitle("从模板新建").click();

    const popover = page.locator(".template-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("内置模板会预设正文结构和元数据，创建后可自由修改")).toBeVisible();

    const geometry = await popover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const hit = document.elementFromPoint(rect.right - 4, rect.top + rect.height / 2);
      return {
        parentIsBody: element.parentElement === document.body,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportLeft,
        viewportTop,
        viewportRight,
        viewportBottom,
        rightEdgeIsInteractive: hit === element || element.contains(hit),
      };
    });
    expect(geometry.parentIsBody).toBe(true);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.viewportLeft);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportRight);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom);
    expect(geometry.rightEdgeIsInteractive).toBe(true);
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
      const toolbarRect = document.querySelector(".editor-menu")!.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        toolbarBottom: toolbarRect.bottom,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.top - geometry.toolbarBottom).toBeGreaterThanOrEqual(3);
    expect(geometry.top - geometry.toolbarBottom).toBeLessThanOrEqual(5);
    await expect(menu.getByRole("button", { name: /导出 Markdown/ })).toBeVisible();
    expect(await menu.locator(".mobile-action-sheet-content").evaluate((content) =>
      content.scrollHeight - content.clientHeight)).toBeLessThanOrEqual(2);
    await expect(menu.locator(".mobile-action-sheet-scroll-hint")).toHaveCount(0);
  });

  test("手机端可从更多菜单在当前块内插入 hard break", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一行");
    await editor.press("End");

    await page.getByTitle("更多编辑操作").click();
    const menu = page.getByRole("dialog", { name: "更多编辑操作" });
    const hardBreak = menu.getByRole("button", { name: "↵ 块内换行" });
    await expect(hardBreak).toBeEnabled();
    await hardBreak.click();
    await expect(menu).toHaveCount(0);
    await page.keyboard.type("第二行");

    const blocks = editor.locator(":scope > *");
    const currentBlock = blocks.first();
    await expect(blocks).toHaveCount(1);
    await expect(currentBlock.locator("br")).toHaveCount(1);
    await expect(currentBlock).toHaveText("第一行第二行");

    await expect(page.getByTitle("已保存")).toBeVisible({ timeout: 15000 });
    await page.reload();
    const restoredBlocks = page.locator(".ProseMirror > *");
    await expect(restoredBlocks).toHaveCount(1);
    await expect(restoredBlocks.first().locator("br")).toHaveCount(1);
    await expect(restoredBlocks.first()).toHaveText("第一行第二行");
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
    const header = sheet.locator(".mobile-action-sheet-header");
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error("更多面板标题不可见");
    await swipeNoteEditor(header, {
      startX: headerBox.x + headerBox.width / 2,
      startY: headerBox.y + 10,
      endX: headerBox.x + headerBox.width / 2,
      endY: headerBox.y + 100,
    });
    await expect(sheet).toBeHidden();
    expect(downloadCount).toBe(0);
  });

  test("虚拟键盘打开时更多菜单上移以完整展示操作", async ({ page }) => {
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
      const toolbarRect = document.querySelector(".editor-menu")!.getBoundingClientRect();
      return {
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        toolbarBottom: toolbarRect.bottom,
        viewportTop: appRect.top,
        viewportBottom: appRect.bottom,
      };
    });
    expect(geometry.menuTop).toBeGreaterThanOrEqual(geometry.viewportTop);
    expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.viewportBottom);
    expect(geometry.menuTop).toBeLessThan(geometry.toolbarBottom);
    await expect(sheet.getByRole("button", { name: /导出 Markdown/ })).toBeVisible();
    const lastAction = sheet.getByRole("button", { name: "放大编辑器字号" });
    await expect(lastAction).toBeVisible();
    expect(await sheet.locator(".mobile-action-sheet-content").evaluate((content) =>
      content.scrollHeight - content.clientHeight)).toBeLessThanOrEqual(2);
    await expect(sheet.locator(".mobile-action-sheet-scroll-hint")).toHaveCount(0);
  });

  test("更多弹层触摸由面板处理，滑动不会被工具栏提前转为点击", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("更多编辑操作").click();
    const sheet = page.getByRole("dialog", { name: "更多编辑操作" });
    const action = sheet.getByRole("button", { name: "放大编辑器字号" });
    const result = await action.evaluate((button) => {
      let clicks = 0;
      button.addEventListener("click", () => { clicks += 1; });
      const dispatch = (type: string, y: number) => {
        const touch = { identifier: 17, target: button, clientX: 100, clientY: y };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchend" ? [] : [touch] },
          changedTouches: { value: [touch] },
        });
        button.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const startPrevented = dispatch("touchstart", 300);
      dispatch("touchmove", 250);
      dispatch("touchend", 250);
      const prematureClicks = clicks;
      // WebKit may emit a compatibility click after a scroll. The sheet must swallow it.
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { startPrevented, prematureClicks, clicks };
    });
    expect(result).toEqual({ startPrevented: false, prematureClicks: 0, clicks: 0 });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    const before = await page.locator(".ProseMirror").evaluate((editor) => parseFloat(getComputedStyle(editor).fontSize));
    await action.tap();
    await expect.poll(() => page.locator(".ProseMirror").evaluate((editor) => parseFloat(getComputedStyle(editor).fontSize)))
      .toBe(before + 1);
  });

  test("更多菜单在窄屏和横屏优先完整显示，极小视口仍可滚动", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("更多编辑操作").click();
    const sheet = page.getByRole("dialog", { name: "更多编辑操作" });
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 760, height: 390 },
      { width: 390, height: 760 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => sheet.locator(".mobile-action-sheet-content").evaluate((content) =>
        content.scrollHeight - content.clientHeight)).toBeLessThanOrEqual(2);
      const bounds = await sheet.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
    }
    await page.setViewportSize({ width: 390, height: 280 });
    await expect(sheet.locator(".mobile-action-sheet-scroll-hint")).toBeVisible();
    const lastAction = sheet.getByRole("button", { name: "放大编辑器字号" });
    await lastAction.scrollIntoViewIfNeeded();
    await expect(sheet.locator(".mobile-action-sheet-scroll-hint")).toHaveCount(0);
    const rect = await lastAction.boundingBox();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(280);
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

    await touch(page.getByTitle("样式"));
    await expect(boldButton).toBeVisible();
    await editor.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
    await expect(boldButton).toBeHidden();
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

  test("新建文档默认布局不产生横向或纵向滚动条", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:sidebarHidden", "true"));
    await page.goto("/");

    await page.getByTitle("文档视图").click();
    const popup = page.locator(".doc-tree-popup-overlay");
    await popup.getByTitle("新建文档").click();

    const dialog = page.locator(".doc-create-dialog");
    const body = dialog.locator(".dialog-body");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".dialog-template-chip").first()).toBeVisible();
    const firstPathOption = dialog.locator(".dialog-path-row option").first();
    await expect(firstPathOption).toHaveText(/Projects$/);
    await expect(firstPathOption).not.toContainText("活跃项目");

    const layout = await body.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);

    await dialog.getByRole("button", { name: /会议纪要/ }).click();
    await dialog.getByPlaceholder("文档标题...").fill("模板正文测试");
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText("会议信息");
    await expect(page.locator(".ProseMirror")).toContainText("行动项");
  });

  test("新建文档在虚拟键盘打开时完整停留在可视区域", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:sidebarHidden", "true"));
    await page.goto("/");
    await page.getByTitle("文档视图").click();
    await page.locator(".doc-tree-popup-overlay").getByTitle("新建文档").click();

    const overlay = page.locator(".doc-create-overlay");
    const dialog = page.locator(".doc-create-dialog");
    const body = dialog.locator(".dialog-body");
    const footer = dialog.locator(".dialog-footer");
    await expect(dialog.locator(".dialog-template-chip").first()).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-visual-viewport-offset-top", "70px");
      document.documentElement.style.setProperty("--app-visual-viewport-offset-left", "4px");
      document.documentElement.style.setProperty("--app-viewport-height", "330px");
      document.documentElement.style.setProperty("--app-viewport-width", "382px");
      document.documentElement.classList.add("web-keyboard-open");
    });

    await expect.poll(() => overlay.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })).toEqual({ top: 70, left: 4, width: 382, height: 330 });

    await expect.poll(async () => {
      const [overlayRect, dialogRect] = await Promise.all([
        overlay.evaluate((element) => element.getBoundingClientRect()),
        dialog.evaluate((element) => element.getBoundingClientRect()),
      ]);
      return Math.round(dialogRect.top - overlayRect.top);
    }).toBe(8);

    const visibleBottom = 400;
    expect(await dialog.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(visibleBottom);
    expect(await footer.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(visibleBottom);
    await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    const conceptInput = dialog.getByPlaceholder("输入概念名后按 Enter 添加...");
    await conceptInput.focus();
    await expect.poll(async () => {
      const [inputRect, bodyRect] = await Promise.all([
        conceptInput.evaluate((element) => element.getBoundingClientRect()),
        body.evaluate((element) => element.getBoundingClientRect()),
      ]);
      return inputRect.bottom <= bodyRect.bottom - 8 && inputRect.top >= bodyRect.top + 8;
    }).toBe(true);

    // 收起键盘后恢复布局视口尺寸，但新建面板仍锚定可视区域上方。
    await page.evaluate(() => document.documentElement.classList.remove("web-keyboard-open"));
    await expect.poll(async () => {
      const [overlayRect, dialogRect] = await Promise.all([
        overlay.evaluate((element) => element.getBoundingClientRect()),
        dialog.evaluate((element) => element.getBoundingClientRect()),
      ]);
      return Math.round(dialogRect.top - overlayRect.top);
    }).toBe(8);
  });

  test("快速切换浮层在虚拟键盘打开时停留在可视区域", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+p");
    const overlay = page.locator(".quick-switcher-overlay");
    const dialog = page.getByRole("dialog", { name: "快速切换笔记" });
    await expect(dialog).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-visual-viewport-offset-top", "70px");
      document.documentElement.style.setProperty("--app-visual-viewport-offset-left", "4px");
      document.documentElement.style.setProperty("--app-viewport-height", "330px");
      document.documentElement.style.setProperty("--app-viewport-width", "382px");
      document.documentElement.classList.add("web-keyboard-open");
    });

    await expect.poll(() => overlay.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })).toEqual({ top: 70, left: 4, width: 382, height: 330 });
    expect(await dialog.evaluate((element) => element.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(400);
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

  test("软键盘打开时应用外壳跟随 iOS Visual Viewport", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-visual-viewport-offset-top", "120px");
      document.documentElement.style.setProperty("--app-visual-viewport-offset-left", "4px");
      document.documentElement.style.setProperty("--app-viewport-height", "430px");
      document.documentElement.style.setProperty("--app-viewport-width", "382px");
      document.documentElement.classList.add("web-keyboard-open");
    });

    const rect = await page.locator(".app").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom };
    });
    expect(rect).toEqual({ top: 120, left: 4, width: 382, height: 430, bottom: 550 });
  });

  test("搜索收起虚拟键盘后左右侧栏与遮罩恢复整屏高度", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("显示侧栏").click();
    await page.getByTitle("新建文档").click();
    await page.getByPlaceholder("文档标题...").fill("搜索后侧栏布局");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("搜索后侧栏布局");
    if (!await page.locator(".app-sidebar").evaluate((element) => element.classList.contains("sidebar-hidden"))) {
      await page.getByTitle("隐藏侧栏").click();
    }
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 24 }, (_, i) => i === 18 ? "夜色中的搜索目标" : `正文第 ${i + 1} 段`).join("\n"));
    await expect(page.locator(".save-status-saved")).toBeVisible();
    await page.getByTitle("点击设为只读").click();
    await page.getByTitle("搜索", { exact: true }).click();
    await page.locator(".search-input").fill("色");

    // 模拟键盘的真实 viewport resize 链路，而非直接写应用 CSS 状态。
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 430 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
    await expect(page.locator(".app")).toHaveCSS("height", "430px");
    await page.locator(".search-hit").filter({ hasText: "搜索后侧栏布局" }).click();
    await expect(page.locator(".search-match-active")).toHaveText("色");
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height");
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
    const host = page.locator(".note-editor");
    await swipeNoteEditor(host, { startX: 8, startY: 400, endX: 108, endY: 405 });
    const sidebar = page.getByRole("dialog", { name: "文档侧栏" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator(".doc-tree-selected")).toContainText("搜索后侧栏布局");
    for (const selector of [".app-sidebar", ".sidebar-overlay"]) {
      await expect(page.locator(selector)).toHaveCSS("height", "760px");
    }
    // 底部也必须命中遮罩，不能点穿到正文。
    expect(await page.evaluate(() => document.elementFromPoint(375, 730)?.classList.contains("sidebar-overlay"))).toBe(true);
    await page.locator(".sidebar-overlay").click({ position: { x: 375, y: 730 } });
    await expect(sidebar).toBeHidden();
    await expect(page.locator(".search-match-active")).toHaveText("色");

    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await swipeNoteEditor(host, { startX: 382, startY: 190, endX: 282, endY: 195 });
    await expect(page.getByRole("dialog", { name: "阅读侧栏" })).toBeVisible();
    await expect(page.locator(".mobile-document-drawer")).toHaveCSS("height", "760px");
    expect(await page.evaluate(() => document.elementFromPoint(8, 730)?.classList.contains("mobile-document-drawer-backdrop"))).toBe(true);
  });

  test("键盘打开后旋转时侧栏不保留旧方向的宽高", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("显示侧栏").click();
    for (const next of [{ width: 760, height: 390 }, { width: 390, height: 760 }]) {
      const keyboardHeight = await page.evaluate(() => {
        const height = window.innerHeight - 230;
        for (const [name, value] of Object.entries({ width: window.innerWidth, height })) {
          Object.defineProperty(window.visualViewport!, name, { configurable: true, value });
        }
        window.visualViewport!.dispatchEvent(new Event("resize"));
        return height;
      });
      await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
      await expect(page.locator(".app-sidebar")).toHaveCSS("height", `${keyboardHeight}px`);
      // 布局视口先旋转，Visual Viewport 暂留原方向的键盘尺寸。
      await page.setViewportSize(next);
      await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
      await expect(page.locator(".app-sidebar")).toHaveCSS("height", `${next.height}px`);
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("height", `${next.height}px`);
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("width", `${next.width}px`);
      await page.evaluate(() => {
        Reflect.deleteProperty(window.visualViewport!, "width");
        Reflect.deleteProperty(window.visualViewport!, "height");
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
    }
  });

  test("横竖屏切换时忽略滞后的 Visual Viewport 尺寸", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-viewport-height", "390px");
      document.documentElement.style.setProperty("--app-viewport-width", "760px");
    });
    await expect(page.locator(".app")).toHaveCSS("width", "390px");
    await expect(page.locator(".app")).toHaveCSS("height", "760px");

    await page.setViewportSize({ width: 760, height: 390 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-viewport-height", "760px");
      document.documentElement.style.setProperty("--app-viewport-width", "390px");
    });
    await expect(page.locator(".app")).toHaveCSS("width", "760px");
    await expect(page.locator(".app")).toHaveCSS("height", "390px");
  });

  test("键盘打开时状态栏下方不重复保留安全区", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.documentElement.classList.add("web-keyboard-open"));
    await expect(page.locator(".app-main")).toHaveCSS("padding-bottom", "0px");
  });

  test("编辑状态下光标不会被底部边界遮挡", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^外观与排版/ }).click();
    await page.getByRole("button", { name: /^编辑器设置/ }).click();
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
        textSizeAdjust: getComputedStyle(document.documentElement).getPropertyValue("text-size-adjust")
          || getComputedStyle(document.documentElement).getPropertyValue("-webkit-text-size-adjust"),
        textSizeAdjustSupported: CSS.supports("text-size-adjust", "100%") || CSS.supports("-webkit-text-size-adjust", "100%"),
        ratio: (caret.top - root.top) / root.height,
        visible: caret.bottom >= root.top + 8 && caret.top <= root.bottom - 20,
      };
    });

    const portraitBefore = await readCaretLayout();
    // 桌面 WebKit 构建可能不提供移动端字体自动放大属性；仍检查实际字体
    // 大小和横竖屏定位，有该能力的浏览器再验证禁用自动放大的样式。
    if (portraitBefore.textSizeAdjustSupported) expect(portraitBefore.textSizeAdjust).toBe("100%");

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
