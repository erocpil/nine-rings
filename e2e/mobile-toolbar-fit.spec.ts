import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// Default workspace order: top third opens the tree, middle third the list.
// Use the visible viewport so the gesture still lands in the right zone after
// rotation. Dispatch touch events through the real edge-swipe handlers.
async function openLeftPanel(page: Page, zone: "tree" | "list") {
  await page.locator(".app-main").evaluate((element, zone) => {
    window.getSelection()?.removeAllRanges();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const y = (viewport?.offsetTop ?? 0)
      + (viewport?.height ?? window.innerHeight) * (zone === "tree" ? 1 / 6 : 1 / 2);
    for (const [type, x] of [["touchstart", left + 8], ["touchmove", left + 160], ["touchend", left + 160]] as const) {
      const touch = { identifier: 81, target: element, clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    }
  }, zone);
}

test("工具栏按宽度补回按钮，手机横屏隐藏密码入口并加宽目录", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const toolbar = page.locator(".editor-menu");
  const inspect = () => toolbar.evaluate(el => {
    const optional = Array.from(el.querySelectorAll<HTMLElement>(".toolbar-secondary > *"));
    return { visible: optional.filter(child => getComputedStyle(child).display !== "none").length,
      overflow: el.scrollWidth - el.clientWidth };
  });
  await expect.poll(async () => (await inspect()).visible).toBeGreaterThan(0);
  expect((await inspect()).overflow).toBeLessThanOrEqual(2);
  const portrait = (await inspect()).visible;
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await inspect()).visible).toBeGreaterThan(portrait);
  expect((await inspect()).overflow).toBeLessThanOrEqual(2);
  await expect(page.locator(".document-security-bar")).toHaveCount(0);
  await openLeftPanel(page, "tree");
  const sidebar = page.getByRole("dialog", { name: "文档侧栏", exact: true });
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await sidebar.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
  await expect(sidebar).not.toBeVisible();
  await openLeftPanel(page, "list");
  const documentList = page.locator(".doc-tree-popup");
  await expect(documentList).toBeVisible();
  expect((await documentList.boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await page.getByRole("button", { name: "关闭文档视图", exact: true }).click();
  await expect(documentList).not.toBeVisible();
  await page.getByRole("button", { name: "文档目录", exact: true }).click();
  const outline = page.getByRole("navigation", { name: "文档目录", exact: true });
  await expect(outline).toBeVisible();
  expect((await outline.boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await page.screenshot({ path: "/tmp/nr-toolbar-fit-landscape.png" });
  await page.getByRole("button", { name: "文档目录", exact: true }).click();
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  const bookmarks = page.getByRole("navigation", { name: "文档书签", exact: true });
  await expect(bookmarks).toBeVisible();
  expect((await bookmarks.boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await inspect()).visible).toBe(portrait);
  expect((await inspect()).overflow).toBeLessThanOrEqual(2);
  await page.getByTitle("更多编辑操作", { exact: true }).click();
  await expect(page.getByRole("button", { name: "插入图片", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/nr-toolbar-fit-portrait.png" });
});
