import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

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
  await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
  const sidebar = page.getByRole("dialog", { name: "文档侧栏", exact: true });
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
  await page.getByTitle("文档视图", { exact: true }).click();
  expect((await page.locator(".doc-tree-popup").boundingBox())!.width).toBeGreaterThanOrEqual(844 * 2 / 3);
  await page.getByRole("button", { name: "关闭文档视图", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "🖼 插入图片", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/tmp/nr-toolbar-fit-portrait.png" });
});
