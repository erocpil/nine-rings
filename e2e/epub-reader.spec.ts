import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test.use({ hasTouch: true });

function createEpubFixture(): Buffer {
  const files = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">nine-rings-epub-test</dc:identifier>
          <dc:title>Nine Rings EPUB MVP</dc:title>
          <dc:creator>测试作者</dc:creator>
          <dc:language>zh-CN</dc:language>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
          <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
          <item id="style" href="book.css" media-type="text/css"/>
          <item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
        </manifest>
        <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
      </package>`),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">开始阅读</a><ol><li><a href="chapter-2.xhtml#target">继续阅读</a></li></ol></li></ol></nav>
      </body></html>`),
    "OEBPS/book.css": strToU8("h1 { letter-spacing: 0.02em; }"),
    "OEBPS/cover.svg": strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#315f9b"/><text x="200" y="300" text-anchor="middle" fill="white">Nine Rings</text></svg>`),
    "OEBPS/chapter-1.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>开始阅读</title><link rel="stylesheet" href="book.css"/></head>
      <body><h1>第一章</h1><p>这是 EPUB 第一章正文。</p><p id="hard-line-a">At one time or</p><p id="hard-line-b">another, this line should be joined.</p><p id="manual-line-a">Manual line break</p><p id="manual-line-b">Needs exact repair.</p><a href="chapter-2.xhtml#target">正文下一章</a><script>parent.document.body.dataset.epubUnsafe='true'</script></body></html>`),
    "OEBPS/chapter-2.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>继续阅读</title></head>
      <body><h1 id="target">第二章</h1><p>阅读进度应当保存到这里。</p><div style="height: 1800px"></div><p>章节末尾内容。</p></body></html>`),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

test("本地 EPUB 可导入、阅读目录章节并恢复进度", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();

  await page.locator('input[type="file"][accept="application/epub+zip,.epub"]').setInputFiles({
    name: "nine-rings-mvp.epub",
    mimeType: "application/epub+zip",
    buffer: createEpubFixture(),
  });

  const reader = page.getByRole("region", { name: "EPUB 阅读器", exact: true });
  const toc = page.getByRole("complementary", { name: "EPUB 目录", exact: true });
  await expect(reader).toBeVisible();
  await expect(page.locator(".pdf-reader-title")).toHaveText("Nine Rings EPUB MVP");
  await expect(toc).toBeVisible();
  await expect(toc.getByRole("button", { name: "开始阅读", exact: true })).toBeVisible();
  await toc.getByRole("button", { name: "折叠 开始阅读" }).click();
  await expect(toc.getByRole("button", { name: "继续阅读" })).toBeHidden();
  await toc.getByRole("button", { name: "展开 开始阅读" }).click();
  await expect(toc.getByRole("button", { name: "继续阅读" })).toBeVisible();
  await toc.getByRole("button", { name: "折叠全部 EPUB 目录" }).click();
  await expect(toc.getByRole("button", { name: "继续阅读" })).toBeHidden();
  await toc.getByRole("button", { name: "展开全部 EPUB 目录" }).click();
  await expect(toc.getByRole("button", { name: "继续阅读" })).toBeVisible();

  const chapterFrame = page.locator(".epub-chapter-frame").contentFrame();
  const swipeFrame = async (fromX: number, toX: number) => chapterFrame.locator("body").evaluate((element, points) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: points.fromX, clientY: 300 }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: points.toX, clientY: 304 }));
  }, { fromX, toX });
  await expect(chapterFrame.getByRole("heading", { name: "第一章" })).toBeVisible();
  await expect(chapterFrame.locator("#hard-line-b")).toBeVisible();
  await page.getByRole("button", { name: "智能合并 EPUB 硬换行" }).click();
  await expect(page.getByRole("button", { name: "智能合并 EPUB 硬换行" })).toHaveAttribute("aria-pressed", "true");
  await expect(chapterFrame.locator("#hard-line-b")).toHaveCount(0);
  await expect(chapterFrame.locator("#hard-line-a")).toContainText("At one time or another, this line should be joined.");
  const manualLineTop = await chapterFrame.locator("#manual-line-a").evaluate((element) => element.getBoundingClientRect().top);
  await chapterFrame.locator("#manual-line-a").evaluate((element) => {
    const next = element.nextElementSibling;
    if (!next) throw new Error("missing manual line continuation");
    const selection = element.ownerDocument.defaultView?.getSelection();
    const range = element.ownerDocument.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(next.firstChild!, next.firstChild?.textContent?.length ?? 0);
    selection?.removeAllRanges();
    selection?.addRange(range);
    next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "合并此处断行" }).click();
  await expect(chapterFrame.locator("#manual-line-b")).toHaveCount(0);
  await expect(chapterFrame.locator("#manual-line-a")).toContainText("Manual line break Needs exact repair.");
  await expect.poll(() => chapterFrame.locator("#manual-line-a").evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(manualLineTop, 0);
  await expect(page.getByRole("button", { name: "管理 EPUB 人工断行修复" })).toContainText("1");
  await swipeFrame(300, 390);
  await expect(page.getByRole("status")).toHaveText("已经是第一章");
  await swipeFrame(330, 100);
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await swipeFrame(330, 100);
  await expect(page.getByRole("status")).toHaveText("已经是最后一章");
  await swipeFrame(100, 330);
  await expect(chapterFrame.getByRole("heading", { name: "第一章" })).toBeVisible();
  await expect(chapterFrame.locator('script[src="/epub-frame-bridge.js"]')).toHaveCount(1);
  await expect(chapterFrame.locator('script:not([src="/epub-frame-bridge.js"])')).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-epub-unsafe");

  await toc.getByRole("button", { name: "继续阅读" }).click();
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await toc.getByRole("button", { name: "开始阅读", exact: true }).click();
  await chapterFrame.getByRole("link", { name: "正文下一章" }).click();
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();

  await toc.getByRole("button", { name: "开始阅读", exact: true }).click();
  await page.getByLabel("搜索 EPUB").fill("阅读进度");
  await page.getByLabel("下一个 EPUB 搜索结果").click();
  await expect(chapterFrame.locator("mark.epub-search-current")).toHaveText("阅读进度");
  await expect(page.locator(".epub-search")).toContainText("1/1");

  await page.getByLabel("EPUB 字号").getByRole("button", { name: "A＋" }).click();
  await expect(page.getByLabel("EPUB 字号")).toContainText("110%");
  await page.getByRole("button", { name: "护眼主题" }).click();
  await expect(reader).toHaveClass(/epub-theme-sepia/);
  const sepiaButton = page.getByRole("button", { name: "护眼主题" });
  await sepiaButton.dispatchEvent("pointerdown");
  await page.waitForTimeout(550);
  await sepiaButton.dispatchEvent("pointerup");
  const backgroundPalette = page.getByRole("dialog", { name: "EPUB 背景色板" });
  await expect(backgroundPalette).toBeVisible();
  await backgroundPalette.getByRole("button", { name: "选择背景色 #eaf2e3" }).click();
  await expect(chapterFrame.locator("html")).toHaveCSS("background-color", "rgb(234, 242, 227)");
  await backgroundPalette.getByRole("button", { name: "关闭 EPUB 背景色板" }).click();
  await chapterFrame.locator("html").evaluate((element) => element.ownerDocument.defaultView?.scrollTo(0, 900));
  await page.waitForTimeout(250);
  await expect.poll(() => chapterFrame.locator("html").evaluate((element) => element.ownerDocument.defaultView?.scrollY ?? 0)).toBeGreaterThan(400);

  await page.getByRole("button", { name: "关闭 EPUB 阅读器" }).click();
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  const libraryEntry = page.getByRole("button", { name: "打开 Nine Rings EPUB MVP" });
  await expect(libraryEntry.locator(".reader-library-cover img")).toBeVisible();
  await expect(libraryEntry).toContainText("测试作者");
  await expect(libraryEntry).toContainText("第 2/2 章");
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".reader-library-items")).toHaveClass(/reader-library-list/);
  const formatFilter = page.getByLabel("阅读资料库格式筛选");
  await formatFilter.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(libraryEntry).toBeHidden();
  await formatFilter.getByRole("button", { name: "EPUB", exact: true }).click();
  await expect(libraryEntry).toBeVisible();
  await libraryEntry.click();

  await expect(reader).toBeVisible();
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await expect(page.getByLabel("EPUB 字号")).toContainText("110%");
  await expect(reader).toHaveClass(/epub-theme-sepia/);
  await expect(page.getByRole("button", { name: "智能合并 EPUB 硬换行" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "管理 EPUB 人工断行修复" })).toContainText("1");
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await expect.poll(() => chapterFrame.locator("html").evaluate((element) => element.ownerDocument.defaultView?.scrollY ?? 0)).toBeGreaterThan(400);

  await chapterFrame.getByText("阅读进度应当保存到这里。").evaluate((element) => {
    const selection = element.ownerDocument.defaultView?.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "高亮", exact: true }).click();
  await expect(chapterFrame.locator("mark.epub-highlight")).toContainText("阅读进度应当保存到这里");
  const epubNote = page.getByRole("textbox", { name: "EPUB 高亮备注" });
  await epubNote.fill("这是 EPUB 备注");
  await epubNote.blur();
  await page.getByRole("button", { name: "完成", exact: true }).click();

  await page.getByRole("button", { name: "打开 EPUB 书签" }).click();
  let bookmarkDialog = page.getByRole("dialog", { name: "EPUB 书签" });
  await expect(bookmarkDialog).toBeVisible();
  await bookmarkDialog.getByRole("button", { name: "添加当前位置书签" }).click();
  await expect(bookmarkDialog.getByRole("button", { name: "取消本章书签" })).toBeVisible();
  await bookmarkDialog.getByRole("button", { name: "关闭 EPUB 书签" }).click();
  await page.getByRole("button", { name: "进入 EPUB 专注模式" }).click();
  await expect(reader).toHaveClass(/epub-reader-focus/);
  await expect(page.locator(".epub-reader-toolbar")).toBeHidden();
  await expect(page.locator(".epub-bottom-navigation")).toBeHidden();
  await expect(page.locator(".epub-focus-exit")).toBeHidden();
  await chapterFrame.locator("body").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: 80, clientY: 160 }));
    const touchStart = new Event("touchstart", { bubbles: true });
    Object.defineProperty(touchStart, "touches", { value: [{ clientX: 80, clientY: 160 }] });
    element.dispatchEvent(touchStart);
    element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch", isPrimary: true, clientX: 81, clientY: 161 }));
    const touchEnd = new Event("touchend", { bubbles: true });
    Object.defineProperty(touchEnd, "changedTouches", { value: [{ clientX: 82, clientY: 162 }] });
    element.dispatchEvent(touchEnd);
  });
  await expect(page.locator(".epub-bottom-navigation")).toBeVisible();
  await expect(page.locator(".epub-focus-exit")).toHaveText("↙️");
  await chapterFrame.locator("body").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".epub-bottom-navigation")).toBeHidden();
  await chapterFrame.locator("body").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".epub-bottom-navigation")).toBeVisible();
  await expect(page.locator(".epub-bottom-navigation")).toBeHidden({ timeout: 2_000 });
  await chapterFrame.locator("body").click({ position: { x: 8, y: 8 } });
  await page.getByRole("button", { name: "退出 EPUB 专注模式" }).click();

  await chapterFrame.getByText("阅读进度应当保存到这里。").evaluate((element) => {
    const selection = element.ownerDocument.defaultView?.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "摘录到笔记" }).click();
  await expect(page.locator(".note-title")).toHaveValue(/EPUB 摘录/);
  await page.getByRole("button", { name: "EPUB · 2" }).click({ force: true });
  await expect(reader).toBeVisible();
  await expect(chapterFrame.locator("mark.epub-highlight-target")).toContainText("阅读进度应当保存到这里");
  await page.getByRole("button", { name: "打开 EPUB 书签" }).click();
  bookmarkDialog = page.getByRole("dialog", { name: "EPUB 书签" });
  await expect(bookmarkDialog.getByRole("button", { name: "取消本章书签" })).toBeVisible();
  await expect(bookmarkDialog.locator(".epub-annotation-item > button:first-child")).toHaveText(/继续阅读 · \d+%/);
  await expect(bookmarkDialog.getByRole("button", { name: /删除书签 继续阅读 · \d+%/ })).toBeVisible();
  await bookmarkDialog.getByRole("button", { name: "关闭 EPUB 书签" }).click();
  await chapterFrame.locator("mark.epub-highlight-target").click();
  await expect(page.getByRole("textbox", { name: "EPUB 高亮备注" })).toHaveValue("这是 EPUB 备注");
  await page.getByRole("button", { name: "完成", exact: true }).click();

  // iOS 安装版在后台停留较久后可能回收 iframe 的正文 realm；恢复时应重建
  // 当前章节，而不是让高亮刷新对 null body 调用 normalize 导致整页崩溃。
  await chapterFrame.locator("body").evaluate((body) => body.remove());
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(reader).toBeVisible();
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await expect(chapterFrame.locator("mark.epub-highlight-target")).toContainText("阅读进度应当保存到这里");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "进入 EPUB 专注模式" }).click();
  await expect(reader).toHaveClass(/epub-reader-focus/);
  await expect(page.locator(".epub-reader-toolbar")).toBeHidden();
  await expect(page.locator(".epub-bottom-navigation")).toBeHidden();
  await expect(page.locator(".epub-focus-exit")).toBeHidden();
  const frameBox = await page.locator(".epub-chapter-frame").boundingBox();
  if (!frameBox) throw new Error("EPUB frame is not visible");
  const cdp = await page.context().newCDPSession(page);
  const dispatchSwipe = async (fromX: number, toX: number) => {
    const y = frameBox.y + frameBox.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: (fromX + toX) / 2, y: y + 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: toX, y: y + 3 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await dispatchSwipe(frameBox.x + 70, frameBox.x + frameBox.width - 70);
  await expect(chapterFrame.getByRole("heading", { name: "第一章" })).toBeVisible();
  await dispatchSwipe(frameBox.x + frameBox.width - 70, frameBox.x + 70);
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await page.touchscreen.tap(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await expect(page.locator(".epub-bottom-navigation")).toBeVisible();
  await expect(page.locator(".epub-focus-exit")).toBeVisible();
  await page.getByRole("button", { name: "退出 EPUB 专注模式" }).click();
  await chapterFrame.locator("html").evaluate((element) => {
    element.ownerDocument.defaultView?.scrollTo(0, 900);
    element.scrollTop = 900;
    element.ownerDocument.body.scrollTop = 900;
  });
  await page.getByRole("button", { name: "关闭 EPUB 阅读器" }).click();
  await page.setViewportSize({ width: 900, height: 844 });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  await page.getByRole("button", { name: "打开 Nine Rings EPUB MVP" }).click();
  await expect.poll(() => chapterFrame.locator("html").evaluate((element) => Math.max(
    element.scrollTop,
    element.ownerDocument.body.scrollTop,
    element.ownerDocument.defaultView?.scrollY ?? 0,
  ))).toBeGreaterThan(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
