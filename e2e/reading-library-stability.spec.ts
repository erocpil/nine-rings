import { expect, test } from "./helpers/reader-test";
import { createPdfFixture } from "./helpers/reader-fixtures";
import { openMobileReadingLibrary } from "./helpers/mobile-reading";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("滑出阅读分栏不卸载正文，关闭后保留文档位置与编辑状态", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.fill("打开阅读前正在编辑的文档。".repeat(160));
  const original = await editor.elementHandle();
  const scroll = page.locator(".note-editor-scroll");
  await scroll.evaluate(element => { element.scrollTop = 450; });
  const offset = await scroll.evaluate(element => element.scrollTop);
  expect(offset).toBeGreaterThan(200);
  for (let cycle = 0; cycle < 3; cycle++) {
    await openMobileReadingLibrary(page);
    const library = page.getByRole("region", { name: "阅读资料库", exact: true });
    await expect(library.locator(".reading-library-content")).toHaveAttribute("aria-busy", "false");
    expect(await original!.evaluate(element => element.isConnected)).toBe(true);
    await expect(page.locator(".app")).toHaveAttribute("inert", "");
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(offset);
    await library.getByRole("button", { name: "退出阅读资料库" }).focus();
    await page.keyboard.press("Control+f");
    await expect(library.getByRole("searchbox", { name: "查找书籍" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(library).toHaveCount(0);
    await expect(page.locator(".app")).not.toHaveAttribute("inert", "");
    expect(await original!.evaluate(element => element.isConnected)).toBe(true);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(offset);
    await expect(editor).toContainText("打开阅读前正在编辑的文档。");
  }
});

test("慢速加载的书库一次呈现最终布局，重新打开前恢复书库滚动位置", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async bytes => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const library = await load("/src/lib/pdf-library.ts");
    for (let index = 0; index < 14; index++) {
      await library.importLocalPdf(new File([new Uint8Array(bytes)], `测试书籍 ${index}.pdf`, { type: "application/pdf" }));
    }
    // Delay metadata independently to expose intermediate empty/partial layouts.
    const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (query, count) {
      const request = original.call(this, query, count);
      if (!["nine_rings_pdf_library", "nine_rings_epub_library"].includes(this.transaction.db.name)) return request;
      const delay = this.transaction.db.name === "nine_rings_pdf_library" ? 800 : 1500;
      return new Proxy(request, {
        get: (target, key) => Reflect.get(target, key, target),
        set: (target, key, value) => Reflect.set(target, key,
          key === "onsuccess" && typeof value === "function"
            ? (event: Event) => setTimeout(() => value.call(target, event), delay) : value, target),
      });
    };
  }, Array.from(createPdfFixture()));
  for (let cycle = 0; cycle < 2; cycle++) {
    await openMobileReadingLibrary(page);
    const library = page.getByRole("region", { name: "阅读资料库", exact: true });
    const content = library.locator(".reading-library-content");
    await expect(library.getByRole("status")).toHaveText("正在读取阅读资料库…");
    await expect(content).toBeHidden();
    await expect(content).toBeVisible();
    await expect(library.locator(".reader-library-item")).toHaveCount(14);
    if (cycle === 1) expect(await content.evaluate(element => element.scrollTop)).toBe(700);
    else {
      const search = library.locator(".reading-library-search");
      const top = (await search.boundingBox())!.y;
      await page.waitForTimeout(250);
      expect((await search.boundingBox())!.y).toBe(top);
    }
    await content.evaluate(element => { element.scrollTop = 700; });
    // Wait for the native scroll event to persist the session before closing.
    await page.waitForTimeout(50);
    await library.getByRole("button", { name: "退出阅读资料库" }).click();
  }
});
