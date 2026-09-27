import { expect, type Page } from "@playwright/test";
import { openMobileReadingLibrary } from "./mobile-reading";

export async function openReadingLibrary(page: Page) {
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  if (await library.isVisible()) return library;
  const desktop = page.getByRole("button", {
    name: "PDF / EPUB 阅读",
    exact: true,
  });
  await expect(page.locator(".note-editor")).toBeVisible();
  if (await page.evaluate(() => !matchMedia("(max-width: 768px)").matches)) {
    // Closing a book remounts its library asynchronously in the already-open panel.
    if (await desktop.getAttribute("aria-expanded") !== "true") await desktop.click();
  } else await openMobileReadingLibrary(page);
  await expect(library).toBeVisible();
  return library;
}

export async function openDocumentSidebar(page: Page) {
  const sidebar = page.locator(".app-sidebar");
  if (
    (await sidebar.isVisible()) &&
    !(await sidebar.evaluate((el) => el.classList.contains("sidebar-hidden")))
  )
    return sidebar;
  const desktop = page.getByRole("button", { name: "文档树", exact: true });
  if (await page.evaluate(() => !matchMedia("(max-width: 768px)").matches))
    await desktop.click();
  else {
    await swipeLeftEdge(page, 0.15);
  }
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await expect(sidebar).toBeVisible();
  return sidebar;
}

async function swipeLeftEdge(page: Page, heightRatio: number) {
  await page.locator(".app").evaluate((element, ratio) => {
    const y = Math.round(innerHeight * ratio);
    for (const [type, x] of [
      ["touchstart", 2],
      ["touchmove", 220],
      ["touchend", 220],
    ] as const) {
      const touch = { identifier: 1, clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    }
  }, heightRatio);
}

export async function closeDocumentSidebar(page: Page) {
  const sidebar = page.locator(".app-sidebar");
  if (
    !(await sidebar.isVisible()) ||
    (await sidebar.evaluate((el) => el.classList.contains("sidebar-hidden")))
  )
    return;
  const desktop = page.getByRole("button", { name: "文档树", exact: true });
  if (await page.evaluate(() => !matchMedia("(max-width: 768px)").matches))
    await desktop.click();
  else
    await sidebar
      .getByRole("button", { name: "隐藏侧栏", exact: true })
      .click();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
}

export async function openMobileDocumentPopup(page: Page) {
  await closeDocumentSidebar(page);
  await swipeLeftEdge(page, 0.5);
  const popup = page.getByRole("dialog", { name: "文档视图", exact: true });
  await expect(popup).toBeVisible();
  return popup;
}

export async function addDocumentTag(page: Page, tag: string) {
  await page.getByTitle("显示属性面板").click();
  const input = page.getByRole("textbox", {
    name: "添加文档标签",
    exact: true,
  });
  await input.fill(tag);
  await input.press("Enter");
  await expect(page.locator(".tag-bar")).toContainText(tag);
  await page.getByTitle("隐藏属性面板").click();
}
