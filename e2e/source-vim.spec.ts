import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, sourceInfo } from "./helpers/source-editor";

test("源码 Vim 动态切换保留正文，Normal/Insert 与撤销正常", async ({ page }) => {
  await createBlankDocument(page, "源码 Vim");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await replaceSource(area, "int value;");
  const toggle = page.getByRole("button", { name: "源码 Vim 模式", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("title", "Vim NORMAL；点击关闭");
  await area.click();
  await page.keyboard.press("i");
  await expect(toggle).toHaveAttribute("title", "Vim INSERT；点击关闭");
  await page.keyboard.type("hello");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("title", "Vim NORMAL；点击关闭");
  await page.keyboard.press("u");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int value;");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int value;");
});


test("只读源码 Vim 显示定位光标并保持只读", async ({ page }) => {
  await createBlankDocument(page, "只读源码 Vim");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await replaceSource(area, "int value;");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  const toggle = page.getByRole("button", { name: "源码 Vim 模式", exact: true });
  await toggle.click();
  await expect(toggle).toHaveText("V");
  await expect(toggle).toHaveAttribute("title", "Vim NORMAL；点击关闭");
  await area.click();
  await expect(page.locator(".cm-vimCursorLayer .cm-fat-cursor").first()).toBeVisible();
  await page.keyboard.press("h");
  await page.keyboard.press("x");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int value;");
});

test("Vim 开启时 Esc 不关闭浮层分栏，包括焦点留在分栏按钮时", async ({ page }) => {
  await createBlankDocument(page, "Vim 分栏 Esc");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await replaceSource(area, "int value;");
  const toggle = page.getByRole("button", { name: "源码 Vim 模式", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("title", "Vim NORMAL；点击关闭");
  await page.evaluate(() => localStorage.setItem("nr:sidebarPresentation", "overlay"));
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const tree = page.locator('[data-sidebar-panel="tree"]');
  const sidebar = page.locator(".app-sidebar");
  if (await sidebar.evaluate(element => element.classList.contains("sidebar-hidden"))) await tree.click();
  await tree.focus();
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
});
