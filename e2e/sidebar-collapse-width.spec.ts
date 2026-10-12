import { test, expect } from "./helpers/reader-test";
import { createBlankDocument } from "./helpers/document";

for (const side of ["left", "right"] as const) {
  for (const [label, key] of [
    ["文档树", "nr:treeSidebarW"],
    ["文档列表", "nr:listSidebarW"],
    ["随记", "nr:notesSidebarW"],
    ["图片", "nr:imagesSidebarW"],
    ["PDF / EPUB 阅读", "nr:readerSidebarW"],
  ]) {
    test(`${side} ${label} 拖动吸入后恢复原宽度`, async ({ page }) => {
      await page.addInitScript(({ side, key }) => {
        localStorage.setItem("nr:workspaceLayout", JSON.stringify({ sidebarSide: side }));
        localStorage.setItem(key, "480");
      }, { side, key });
      await createBlankDocument(page);
      await page.evaluate(async () => {
        const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
        setPluginsEnabled(true);
      });
      const button = page.getByRole("button", { name: label, exact: true });
      if (await button.getAttribute("aria-expanded") !== "true") await button.click();
      const divider = page.locator(".sidebar-divider");
      await expect(divider).toBeVisible();
      const sidebar = page.locator(".app-sidebar");
      const width = () => sidebar.evaluate(el => el.getBoundingClientRect().width);
      await expect.poll(width).toBe(480);
      const original = await width();
      const box = (await divider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(side === "left" ? 45 : 1235, box.y + 100, { steps: 20 });
      await page.mouse.up();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("body")).not.toHaveClass(/app-sidebar-dragging/);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect.poll(width).toBe(original);
      await expect.poll(() => page.evaluate(key => Number(localStorage.getItem(key)), key)).toBe(original);
    });
  }
}
