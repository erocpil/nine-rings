import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

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
        </manifest>
        <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
      </package>`),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">开始阅读</a></li><li><a href="chapter-2.xhtml#target">继续阅读</a></li></ol></nav>
      </body></html>`),
    "OEBPS/book.css": strToU8("h1 { letter-spacing: 0.02em; }"),
    "OEBPS/chapter-1.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>开始阅读</title><link rel="stylesheet" href="book.css"/></head>
      <body><h1>第一章</h1><p>这是 EPUB 第一章正文。</p><a href="chapter-2.xhtml#target">正文下一章</a><script>parent.document.body.dataset.epubUnsafe='true'</script></body></html>`),
    "OEBPS/chapter-2.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>继续阅读</title></head>
      <body><h1 id="target">第二章</h1><p>阅读进度应当保存到这里。</p></body></html>`),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

test("本地 EPUB 可导入、阅读目录章节并恢复进度", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();

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
  await expect(toc.getByRole("button", { name: "开始阅读" })).toBeVisible();

  const chapterFrame = page.locator(".epub-chapter-frame").contentFrame();
  await expect(chapterFrame.getByRole("heading", { name: "第一章" })).toBeVisible();
  await expect(chapterFrame.locator("script")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-epub-unsafe");

  await toc.getByRole("button", { name: "继续阅读" }).click();
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await toc.getByRole("button", { name: "开始阅读" }).click();
  await chapterFrame.getByRole("link", { name: "正文下一章" }).click();
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();

  await page.getByLabel("EPUB 字号").getByRole("button", { name: "A＋" }).click();
  await expect(page.getByLabel("EPUB 字号")).toContainText("110%");
  await page.getByRole("button", { name: "护眼主题" }).click();
  await expect(reader).toHaveClass(/epub-theme-sepia/);

  await page.getByRole("button", { name: "关闭 EPUB 阅读器" }).click();
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  const libraryEntry = page.getByRole("button", { name: "打开 Nine Rings EPUB MVP" });
  await expect(libraryEntry).toContainText("测试作者");
  await expect(libraryEntry).toContainText("第 2/2 章");
  await libraryEntry.click();

  await expect(reader).toBeVisible();
  await expect(page.locator(".epub-chapter-controls")).toContainText("2/2");
  await expect(page.getByLabel("EPUB 字号")).toContainText("110%");
  await expect(reader).toHaveClass(/epub-theme-sepia/);
  await expect(chapterFrame.getByRole("heading", { name: "第二章" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
