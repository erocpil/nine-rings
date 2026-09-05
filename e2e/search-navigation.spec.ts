import { test, expect, type Page } from "@playwright/test";

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

test.describe("搜索定位与编辑器布局锚点", () => {
  test("点击搜索结果定位正文命中，并可在多处命中间导航", async ({ page }) => {
    await createDocument(page, "搜索定位测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一处 unique-search-target 在这里");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("中间内容");
    await editor.press("Enter");
    await editor.type("第二处 unique-search-target 在这里");

    // 等待自动保存把正文同步到全文搜索字段。
    await page.waitForTimeout(800);
    await page.locator(".search-input").fill("unique-search-target");
    const result = page.locator(".search-hit").filter({ hasText: "搜索定位测试" });
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.locator(".search-match")).toHaveCount(2);
    await expect(page.locator(".editor-search-navigation")).toContainText("1 / 2");
    await page.getByRole("button", { name: "下一处匹配" }).click();
    await expect(page.locator(".editor-search-navigation")).toContainText("2 / 2");
    await expect(page.locator(".search-match-active")).toHaveCount(1);
  });

  test("专注模式搜索导航使用显式状态类保持可见", async ({ page }) => {
    await createDocument(page, "专注搜索导航测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill("第一处 focus-search-target\n第二处 focus-search-target");
    await expect(page.locator(".save-status-saved")).toBeVisible();
    await page.getByTitle("专注模式").click();
    await page.locator(".search-input").fill("focus-search-target");
    await page.locator(".search-hit").filter({ hasText: "专注搜索导航测试" }).click();

    const stats = page.locator(".editor-stats-has-search-navigation");
    await expect(stats).toBeVisible();
    await expect(stats.locator(".editor-search-navigation")).toContainText("1 / 2");
  });

  test("文档查找首次下一处从当前光标之后开始", async ({ page }) => {
    await createDocument(page, "文档内查找起点测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill([
      "第一处 needle",
      "光标位于这里",
      "第二处 needle",
      "间隔内容",
      "第三处 needle",
    ].join("\n"));

    await editor.locator(":scope > p").nth(1).click();
    await page.keyboard.press("Alt+f");
    const findInput = page.getByLabel("在当前文档中查找");
    await findInput.fill("needle");
    await expect(page.locator(".editor-find-count")).toHaveText("0/3");

    await page.getByRole("button", { name: "下一处匹配" }).click();
    await expect(page.locator(".editor-find-count")).toHaveText("2/3");
    await expect(editor.locator(":scope > p").nth(2).locator(".search-match-active")).toHaveText("needle");

    await findInput.press("Shift+Enter");
    await expect(page.locator(".editor-find-count")).toHaveText("1/3");
    await expect(editor.locator(":scope > p").nth(0).locator(".search-match-active")).toHaveText("needle");
  });

  test("关闭结果保留关键词，再次聚焦时保存编辑并刷新结果", async ({ page }) => {
    await createDocument(page, "搜索刷新测试");
    const editor = page.locator(".ProseMirror");
    const input = page.locator(".search-input");
    const header = page.locator(".search-results-header");
    const keyword = "fresh-search-target";

    await editor.fill(`正文包含 ${keyword}`);
    await page.waitForTimeout(800);
    await input.fill(keyword);
    await expect(header).toContainText("搜索结果（1）");

    // Esc 只关闭结果，不删除查询；输入框被主动 blur，下一次点击会触发新搜索。
    await input.press("Escape");
    await expect(page.locator(".search-results")).toHaveCount(0);
    await expect(input).toHaveValue(keyword);
    await input.click();
    await expect(header).toContainText("搜索结果（1）");

    // 显式关闭按钮同样保留关键词。修改后不等待 600ms 自动保存，
    // 再次聚焦必须先 flush，因而旧关键词不应继续命中。
    await page.getByRole("button", { name: "关闭搜索结果" }).click();
    await expect(input).toHaveValue(keyword);
    await editor.fill("正文已经改变，不再包含原来的检索词");
    await input.click();
    await expect(header).toContainText("搜索结果（0）");
  });

  test("搜索结果超过可视区域时可向下滚动", async ({ page }) => {
    await createDocument(page, "搜索结果滚动测试");
    const keyword = "scrollable-search-results-target";
    await page.locator(".ProseMirror").fill(`正文包含 ${keyword}`);
    await page.waitForTimeout(800);
    await page.locator(".search-input").fill(keyword);

    const panel = page.locator(".search-results");
    const firstHit = panel.locator(".search-hit").first();
    await expect(firstHit).toBeVisible();
    await panel.evaluate((element) => {
      const hit = element.querySelector(".search-hit");
      if (!hit) throw new Error("Expected a search hit");
      for (let index = 0; index < 80; index += 1) {
        const clone = hit.cloneNode(true) as HTMLElement;
        clone.dataset.testClone = String(index);
        element.appendChild(clone);
      }
    });

    await expect.poll(() => panel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      hasOverflow: element.scrollHeight > element.clientHeight,
    }))).toEqual({ overflowY: "auto", hasOverflow: true });

    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("表格单元格内容进入全文搜索并可定位", async ({ page }) => {
    await createDocument(page, "表格搜索测试");
    const editor = page.locator(".ProseMirror");
    const markdown = "| 名称 | 说明 |\n| --- | --- |\n| DPDK | unique-table-search-value |";
    await editor.click();
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, markdown);
    await expect(editor.locator("table")).toHaveCount(1);
    await page.waitForTimeout(800);

    await page.locator(".search-input").fill("unique-table-search-value");
    const result = page.locator(".search-hit").filter({ hasText: "表格搜索测试" });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.locator(".search-match-active")).toHaveCount(1);
  });

  test("侧栏和窗口宽度变化后保持光标内容的屏幕位置", async ({ page }) => {
    await createDocument(page, "布局锚点测试");
    const editor = page.locator(".ProseMirror");
    const paragraphs = Array.from({ length: 24 }, (_, index) =>
      `第 ${index + 1} 段 ${"用于测试软换行的较长文本 ".repeat(7)}`,
    );
    await editor.fill(paragraphs.join("\n"));

    const anchorParagraph = editor.locator(":scope > p").nth(17);
    await anchorParagraph.scrollIntoViewIfNeeded();
    await anchorParagraph.click();

    const selectionTop = () => page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      return selection.getRangeAt(0).getBoundingClientRect().top;
    });

    const beforeSidebar = await selectionTop();
    expect(beforeSidebar).not.toBeNull();
    await page.getByTitle("隐藏侧栏").click();
    await page.waitForTimeout(100);
    const afterSidebar = await selectionTop();
    expect(Math.abs((afterSidebar ?? 0) - (beforeSidebar ?? 0))).toBeLessThanOrEqual(4);

    // 焦点留在布局按钮时，连续重排也必须延续刚才的正文光标锚点。
    for (const width of [1540, 1100, 1540]) {
      const beforeWindow = await selectionTop();
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
      const afterWindow = await selectionTop();
      expect(Math.abs((afterWindow ?? 0) - (beforeWindow ?? 0))).toBeLessThanOrEqual(4);
      // 超过滚动静止计时器，确保不会二次漂移或在下轮丢失锚点。
      await page.waitForTimeout(200);
      expect(Math.abs((await selectionTop() ?? 0) - (beforeWindow ?? 0))).toBeLessThanOrEqual(4);
    }
  });

  test("布局按钮失焦后滚到其它段落，窗口变宽保持阅读位置而不追随旧光标", async ({ page }) => {
    await createDocument(page, "编辑转阅读锚点测试");
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 48 }, (_, index) =>
      `第 ${index + 1} 段 ${"用于测试阅读位置的长文本 ".repeat(7)}`,
    ).join("\n"));
    const caretParagraph = editor.locator(":scope > p").nth(17);
    await caretParagraph.scrollIntoViewIfNeeded();
    await caretParagraph.click();
    await page.getByTitle("隐藏侧栏").click();
    await page.waitForTimeout(200);

    const readingParagraph = editor.locator(":scope > p").nth(35);
    await readingParagraph.evaluate((element) => {
      const root = document.querySelector<HTMLElement>(".note-editor-scroll")!;
      const sticky = root.querySelector<HTMLElement>(":scope > .note-editor-sticky")!;
      const top = Math.max(root.getBoundingClientRect().top, sticky.getBoundingClientRect().bottom);
      root.scrollTop += element.getBoundingClientRect().top - top + 6;
    });
    await page.waitForTimeout(200);
    const before = (await readingParagraph.boundingBox())!.y;
    const rootTop = (await page.locator(".note-editor-scroll").boundingBox())!.y;
    const caretRect = (await caretParagraph.boundingBox())!;
    expect(caretRect.y + caretRect.height).toBeLessThan(rootTop);

    for (const width of [1540, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(200);
      expect(Math.abs((await readingParagraph.boundingBox())!.y - before)).toBeLessThanOrEqual(4);
    }
  });
});
