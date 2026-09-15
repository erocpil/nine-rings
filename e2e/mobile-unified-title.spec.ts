import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });
const title = "手机统一标题栏：一份很长的文档名称，用于验证横竖屏、专注与阅读布局";

async function fixture(page: Page, readonly = false, virtual = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async ({ title, readonly, virtual }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const { setReadonlyRenderingEnabled } = await load("/src/lib/readonly-rendering.ts") as typeof import("../src/lib/readonly-rendering");
    setReadonlyRenderingEnabled(virtual);
    const note = await api.notes.create({ title, date: "2026-09-15", storagePath: "tests/mobile-title", content: {
      ops: [{ insert: "阅读标题" }, { insert: "\n", attributes: { header: 1 } }, { insert: "正文需要继续滚动和编辑。\n".repeat(120) }],
      metadata: { bookmarks: [{ id: "mobile-title-bookmark", position: 1, preview: "阅读标题", createdAt: new Date().toISOString() }] },
    } });
    const saved = readonly ? await api.notes.update(note.id, { readonly: true }) : note;
    useNotesStore.getState().selectNote(saved);
  }, { title, readonly, virtual });
  const row = page.locator(virtual ? ".vr-title" : ".note-title-row");
  if (readonly) await expect(row.getByRole("button", { name: "查看完整标题" })).toHaveText(title);
  else await expect(row.getByRole("textbox", { name: "文档标题" })).toHaveValue(title);
  return row;
}

async function swipe(target: Locator, startX: number, startY: number, endX: number) {
  await target.evaluate((element, point) => {
    window.getSelection()?.removeAllRanges();
    const touch = (x: number) => ({ identifier: 81, target: element, clientX: x, clientY: point.startY });
    for (const [type, x] of [["touchstart", point.startX], ["touchmove", point.endX], ["touchend", point.endX]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch(x)] }, changedTouches: { value: [touch(x)] },
      });
      element.dispatchEvent(event);
    }
  }, { startX, startY, endX });
}

for (const mode of ["edit", "readonly", "virtual"] as const) {
  test(`手机 ${mode}：普通/专注共用一行，旋转不重复，正文滚动不遮挡标题`, async ({ page }, testInfo) => {
    const row = await fixture(page, mode !== "edit", mode === "virtual");
    for (const viewport of [{ width: 320, height: 760 }, { width: 844, height: 390 }, { width: 390, height: 760 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(landscape => {
        document.documentElement.style.setProperty("--safe-left", landscape ? "44px" : "0px");
        document.documentElement.style.setProperty("--safe-right", landscape ? "44px" : "0px");
      }, viewport.width === 844);
      await expect(page.locator(".app-header, .mobile-focus-bar")).toHaveCount(0);
      await expect(row).toHaveCount(1);
      const assertRow = async () => {
        const bounds = await row.boundingBox();
        expect(bounds!.height).toBeLessThanOrEqual(42);
        if (viewport.width === 844) {
          expect(bounds!.x).toBeGreaterThanOrEqual(44);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
        }
        const actions = row.getByRole("button").filter({ visible: true });
        for (const box of await actions.evaluateAll(nodes => nodes.map(node => {
          const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom };
        }))) {
          expect(box.x).toBeGreaterThanOrEqual(bounds!.x - 1);
          expect(box.right).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
          expect(box.y).toBeGreaterThanOrEqual(bounds!.y - 1);
          expect(box.bottom).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
        }
      };
      await assertRow();
      await expect(row.getByRole("button", { name: "文档书签", exact: true }).locator(".focus-bookmark-count")).toHaveText("1");
      await row.getByRole("button", { name: "专注模式", exact: true }).click();
      await assertRow();
      await expect(page.locator(".mobile-focus-bar")).toHaveCount(0);
      const preview = row.getByRole("button", { name: "查看完整标题" });
      await preview.click();
      await expect(row.getByRole("tooltip")).toHaveText(title);
      await expect(page.locator(".properties-panel")).toHaveCount(0);
      await preview.click();
      await expect(row.getByRole("tooltip")).toHaveCount(0);
      const scroll = page.locator(mode === "virtual" ? ".vr-scroll" : ".note-editor-scroll");
      const top = (await row.boundingBox())!.y;
      await scroll.evaluate(node => { node.scrollTop = 400; });
      await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
      expect((await row.boundingBox())!.y).toBe(top);
      if (mode === "edit") {
        await row.getByRole("button", { name: "更多编辑工具" }).click();
        await expect(page.locator(".editor-menu")).toBeVisible();
        const menu = (await page.locator(".editor-menu").boundingBox())!;
        const header = (await row.boundingBox())!;
        expect(menu.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
        await row.getByRole("button", { name: "更多编辑工具" }).click();
      }
      await row.getByRole("button", { name: "退出专注模式", exact: true }).click();
      await expect(row).toHaveCount(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`mobile-${mode}.png`) });
  });
}

test("统一标题栏保留左右分区滑动和反向收回", async ({ page }) => {
  const row = await fixture(page);
  const host = page.locator(".app-main");
  await swipe(host, 8, 160, 130);
  await expect(page.getByRole("dialog", { name: "文档侧栏", exact: true })).toBeVisible();
  await swipe(page.locator(".sidebar-overlay.active"), 370, 400, 260);
  await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  await swipe(host, 8, 380, 130);
  await expect(page.locator(".doc-tree-popup")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".doc-tree-popup")).not.toBeVisible();
  await swipe(host, 8, 630, 130);
  await expect(page.getByRole("region", { name: "阅读资料库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出阅读资料库", exact: true }).click();
  await row.getByRole("button", { name: "文档书签", exact: true }).click();
  const bookmarkPanel = page.getByRole("navigation", { name: "文档书签", exact: true });
  await expect(bookmarkPanel).toBeVisible();
  expect((await bookmarkPanel.boundingBox())!.y).toBeGreaterThanOrEqual((await row.boundingBox())!.y + (await row.boundingBox())!.height);
  await page.keyboard.press("Escape");
  await swipe(host, 380, 160, 250);
  const drawer = page.getByRole("dialog", { name: "阅读侧栏", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("navigation", { name: "文档书签" })).toBeVisible();
  await swipe(page.locator(".mobile-document-drawer-backdrop"), 12, 400, 130);
  await expect(drawer).not.toBeVisible();
  await swipe(host, 380, 630, 250);
  await expect(page.locator(".settings-panel")).toBeVisible();
  await swipe(page.locator(".settings-panel"), 180, 400, 310);
  await expect(page.locator(".settings-panel")).not.toBeVisible();
});

test("软键盘缩小可视区时标题、编辑工具与正文不重叠", async ({ page }) => {
  const row = await fixture(page);
  await row.getByRole("button", { name: "专注模式", exact: true }).click();
  await row.getByRole("button", { name: "更多编辑工具" }).click();
  await page.locator(".ProseMirror").focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, "height", { configurable: true, value: 360 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 30 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => page.locator(".app").evaluate(node => node.getBoundingClientRect().height)).toBe(360);
  const header = (await row.boundingBox())!;
  const menu = (await page.locator(".editor-menu").boundingBox())!;
  const body = (await page.locator(".note-editor-scroll").boundingBox())!;
  expect(header.y).toBeGreaterThanOrEqual(30);
  expect(menu.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  // The sticky region lives inside this scroll container, above its body.
  await page.locator(".note-editor-scroll").evaluate(node => { node.scrollTop = 0; });
  expect((await page.locator(".editor-content-shell").boundingBox())!.y).toBeGreaterThanOrEqual(menu.y + menu.height - 1);
  expect(body.y + body.height).toBeLessThanOrEqual(391);
  expect(body.height).toBeGreaterThan(100);
  await row.getByRole("button", { name: "更多编辑工具" }).click();
  await row.getByRole("button", { name: "退出专注模式", exact: true }).click();
  await expect(page.locator(".app-header, .mobile-focus-bar")).toHaveCount(0);
});
