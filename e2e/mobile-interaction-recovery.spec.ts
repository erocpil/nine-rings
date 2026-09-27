import { expect, test, type Page } from "@playwright/test";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

async function resizeKeyboard(page: Page, open: boolean) {
  await page.evaluate((isOpen) => {
    const viewport = window.visualViewport!;
    for (const [name, value] of Object.entries({
      height: 430,
      offsetTop: 70,
    })) {
      if (isOpen)
        Object.defineProperty(viewport, name, { configurable: true, value });
      else Reflect.deleteProperty(viewport, name);
    }
    viewport.dispatchEvent(new Event("resize"));
  }, open);
  if (open) await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
  else await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
}

test("键盘打开时应用外壳跟随可视区，文档侧栏仍可操作", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".ProseMirror").focus();
  await resizeKeyboard(page, true);
  const app = page.locator(".app");
  await expect(app).toHaveCSS("top", "70px");
  await expect(app).toHaveCSS("height", "430px");
  const sidebar = await openDocumentSidebar(page);
  // Opening the drawer moves focus away from the editor, dismissing the native
  // keyboard and returning both the shell and drawer to the full viewport.
  await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
  await expect(app).toHaveCSS("height", "760px");
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(sidebarBox.y).toBe(0);
  expect(sidebarBox.y + sidebarBox.height).toBe(760);
  expect(await sidebar.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);
  await closeDocumentSidebar(page);
  await resizeKeyboard(page, false);
  await expect(app).toHaveCSS("height", "760px");
  await expect(app).toHaveCSS("top", "0px");
});

test("专注模式键盘布局保持统一标题行且不预留额外顶部空间", async ({ page }) => {
  await page.goto("/");
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  await page.locator(".ProseMirror").focus();
  const body = page.locator(".app-body");
  const originalPadding = await body.evaluate(
    (element) => getComputedStyle(element).paddingTop,
  );
  await resizeKeyboard(page, true);
  await expect(body).toHaveCSS("padding-top", originalPadding);
  await expect(page.locator(".app")).toHaveCSS("top", "70px");
  const bar = page.locator(".note-title-row");
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(70);
  expect(box.y + box.height).toBeLessThanOrEqual(500);
  await resizeKeyboard(page, false);
  await expect(body).toHaveCSS("padding-top", originalPadding);
  await expect(page.locator(".app")).toHaveCSS("top", "0px");
});
