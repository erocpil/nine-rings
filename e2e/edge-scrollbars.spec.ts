import { expect, test } from "@playwright/test";

test("桌面仅靠近对应滚动边缘显示，滚动和布局不变", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-edge-scrollbars", "");
  // Deterministic nested panes exercise the same delegated events as dynamically
  // mounted trees, lists, editor NodeViews and dialogs, without scanning the DOM.
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.id = "scroll-test";
    panel.style.cssText = "position:fixed;left:100px;top:120px;width:400px;height:400px;overflow:auto;background:white;z-index:99999";
    const inner = document.createElement("div");
    inner.id = "scroll-inner";
    inner.style.cssText = "margin:30px;width:240px;height:160px;overflow:auto";
    const body = document.createElement("div");
    body.style.cssText = "width:700px;height:800px";
    body.textContent = "嵌套代码／引用滚动区域";
    inner.append(body);
    panel.append(inner);
    const tail = document.createElement("div");
    tail.style.height = "1000px";
    panel.append(tail);
    document.body.append(panel);
  });
  const outer = page.locator("#scroll-test"), inner = page.locator("#scroll-inner");
  const dimensions = await inner.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
  const rect = (await inner.boundingBox())!;
  await page.mouse.move(rect.x + 80, rect.y + 60);
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  if (await page.evaluate(() => CSS.supports("scrollbar-color", "transparent transparent"))) {
    await expect(inner).toHaveCSS("scrollbar-color", "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
  }
  await page.mouse.wheel(0, 50);
  await expect.poll(() => inner.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  const before = await inner.evaluate(el => el.scrollTop);
  await page.mouse.move(rect.x + rect.width - 10, rect.y + 60);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  if (await page.evaluate(() => CSS.supports("scrollbar-color", "transparent transparent"))) {
    await expect(inner).not.toHaveCSS("scrollbar-color", "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
  }
  await expect(outer).not.toHaveAttribute("data-scrollbar-visible");
  expect(await inner.evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(dimensions);
  expect(await inner.evaluate(el => el.scrollTop)).toBe(before);
  await page.mouse.down();
  await page.mouse.move(700, 100);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  await page.mouse.up();
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  await page.mouse.move(rect.x + 70, rect.y + rect.height - 8);
  await expect(inner).toHaveAttribute("data-scrollbar-visible", "");
  const outerRect = (await outer.boundingBox())!;
  await page.mouse.move(outerRect.x + outerRect.width - 8, outerRect.y + 280);
  await expect(outer).toHaveAttribute("data-scrollbar-visible", "");
  await expect(inner).not.toHaveAttribute("data-scrollbar-visible");
  await page.mouse.move(700, 100);
  await expect(outer).not.toHaveAttribute("data-scrollbar-visible");
  await outer.evaluate(el => { el.tabIndex = 0; el.focus(); });
  await page.keyboard.press("PageDown");
  await expect.poll(() => outer.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});

test("手机和高对比模式保留原生滚动条", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-edge-scrollbars");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("html")).toHaveAttribute("data-edge-scrollbars", "");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator("html")).not.toHaveAttribute("data-edge-scrollbars");
});
