import { expect, test } from "@playwright/test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";

test("资料库的旧设置入口和键盘返回保持笔记工作区", async ({ page }) => {
  await page.goto("/");
  const title = page.locator(".note-title");
  await expect(title).toBeVisible();
  const before = await title.inputValue();
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(library.getByRole("searchbox", { name: "查找书籍" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(library).toBeHidden();
  await expect(title).toHaveValue(before);
});

for (const width of [390, 1280]) {
  test(`独立阅读入口保留筛选与滚动位置，摘录返回笔记 ${width}`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const showSidebar = page.getByRole("button", {
      name: "显示侧栏",
      exact: true,
    });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page
      .getByRole("button", { name: "打开阅读资料库", exact: true })
      .click();
    const library = page.getByRole("region", {
      name: "阅读资料库",
      exact: true,
    });
    await expect(library).toBeVisible();
    await page.keyboard.press("Control+f");
    await expect(library.getByRole("searchbox", { name: "查找书籍" })).toBeFocused();
    await expect(
      page.getByRole("dialog", { name: "设置", exact: true }),
    ).toBeHidden();
    await expect(library).toContainText("尚未导入 PDF 或 EPUB");
    await library
      .locator('input[accept="application/pdf,.pdf"]')
      .setInputFiles({
        name: "library.pdf",
        mimeType: "application/pdf",
        buffer: createPdfFixture(),
      });
    await expect(page.locator(".pdf-text-layer").first()).toContainText(
      "Nine Rings PDF MVP",
    );
    await page
      .getByRole("button", { name: "关闭 PDF 阅读器", exact: true })
      .click();
    await expect(library).toBeVisible();
    await library
      .locator('input[accept="application/epub+zip,.epub"]')
      .setInputFiles({
        name: "library.epub",
        mimeType: "application/epub+zip",
        buffer: createEpubFixture(),
      });
    await expect(
      page
        .frameLocator(".epub-chapter-frame")
        .getByRole("heading", { name: "第一章" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭 EPUB 阅读器", exact: true })
      .click();
    await expect(
      library.getByRole("button", { name: "继续阅读", exact: true }),
    ).toContainText("Nine Rings EPUB MVP");
    await library
      .getByRole("button", { name: "继续阅读", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "EPUB 阅读器", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "关闭 EPUB 阅读器", exact: true })
      .click();
    const search = library.getByRole("searchbox", { name: "查找书籍" });
    await search.fill("测试作者");
    await expect(library.locator(".reader-library-item")).toHaveCount(1);
    await expect(library.locator(".reader-library-item")).toHaveAttribute(
      "data-format",
      "epub",
    );
    await library
      .getByLabel("阅读资料库格式筛选")
      .getByRole("button", { name: "PDF", exact: true })
      .click();
    await expect(library).toContainText("没有找到匹配的书籍");
    await search.fill("library");
    await library.screenshot({
      path: `/tmp/reading-library-overview-${width}.png`,
    });
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("nine_rings_pdf_library");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("documents", "readwrite");
          const store = tx.objectStore("documents");
          const all = store.getAll();
          all.onsuccess = () => {
            for (let i = 0; i < 24; i++)
              store.put({
                ...all.result[0],
                id: `library-copy-${i}`,
                name: `library-copy-${i}.pdf`,
                lastOpenedAt: "2020-01-01T00:00:00.000Z",
              });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    });
    await library.getByRole("button", { name: "刷新阅读资料库" }).click();
    await expect(library.locator(".reader-library-item")).toHaveCount(25);
    await library.getByRole("button", { name: "列表视图" }).click();
    const item = library.getByRole("button", {
      name: "打开 library-copy-8.pdf",
      exact: true,
    });
    await item.scrollIntoViewIfNeeded();
    const scroll = await library
      .locator(".reading-library-content")
      .evaluate((el) => el.scrollTop);
    expect(scroll).toBeGreaterThan(100);
    await item.click();
    await expect(page.locator(".pdf-text-layer").first()).toContainText(
      "Nine Rings PDF MVP",
    );
    await page
      .getByRole("button", { name: "关闭 PDF 阅读器", exact: true })
      .click();
    await expect(search).toHaveValue("library");
    await expect(
      library
        .getByLabel("阅读资料库格式筛选")
        .getByRole("button", { name: "PDF", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(library.locator(".reader-library-items")).toHaveClass(
      /reader-library-list/,
    );
    await expect
      .poll(() =>
        library
          .locator(".reading-library-content")
          .evaluate((el) => el.scrollTop),
      )
      .toBeCloseTo(scroll, 0);
    await library.screenshot({ path: `/tmp/reading-library-${width}.png` });
    await library
      .getByRole("button", { name: "打开 library.pdf", exact: true })
      .click();
    await page
      .locator(".pdf-text-layer span")
      .filter({ hasText: "Nine Rings PDF MVP" })
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    await page.getByRole("button", { name: "摘录到笔记", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue(/PDF 摘录/);
    await page.getByRole("button", { name: "PDF · 1", exact: true }).click();
    await expect(page.getByLabel("PDF 阅读器", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "关闭 PDF 阅读器", exact: true })
      .click();
    await expect(page.locator(".note-title")).toHaveValue(/PDF 摘录/);
    await expect(library).toBeHidden();
  });
}
