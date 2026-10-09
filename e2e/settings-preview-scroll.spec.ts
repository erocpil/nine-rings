import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

test("桌面设置外部点击不关闭，按住查看正文，释放和失焦恢复且不穿透", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "设置效果预览");
  await page.getByTitle("设置", { exact: true }).click();
  const overlay = page.locator(".settings-overlay");
  await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
  await page.mouse.click(8, 500);
  await expect(overlay).toHaveCount(1);
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await page.mouse.move(800, 500);
  await expect(overlay).toHaveCSS("opacity", "0");
  await page.mouse.up();
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect(page.locator(".note-title:visible")).toHaveValue("设置效果预览");
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(overlay).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

test("源码预览同步在同一滚动事件内更新，双向连续映射并可关闭", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "立即同步滚动");
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: Array.from({ length: 160 }, (_, index) => ({ type: "paragraph", content: [{ type: "text", text: `同步段落 ${index}：${"长文字测试折行。".repeat(index % 4 + 1)}` }] })) }, true);
  });
  await waitForSavedText(page, "同步段落 159");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const split = page.getByRole("button", { name: "并排预览", exact: true });
  if (await split.getAttribute("aria-pressed") !== "true") await split.click();
  await expect(page.locator(".markdown-preview-block")).toHaveCount(160);
  const source = page.locator(".cm-scroller"), preview = page.locator(".markdown-preview-scroll");
  for (const side of ["source", "preview"] as const) {
    const result = await page.evaluate(side => {
      const source = document.querySelector<HTMLElement>(".cm-scroller")!;
      const preview = document.querySelector<HTMLElement>(".markdown-preview-scroll")!;
      const origin = side === "source" ? source : preview, target = side === "source" ? preview : source;
      origin.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      const before = target.scrollTop;
      origin.scrollTop = 700;
      origin.dispatchEvent(new Event("scroll"));
      return { before, after: target.scrollTop };
    }, side);
    expect(Math.abs(result.after - result.before)).toBeGreaterThan(10);
  }
  await preview.evaluate(element => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => source.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await page.getByRole("checkbox", { name: "同步滚动", exact: true }).uncheck();
  const result = await source.evaluate(element => {
    const target = document.querySelector<HTMLElement>(".markdown-preview-scroll")!;
    const before = target.scrollTop;
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
    return { before, after: target.scrollTop };
  });
  expect(result.after).toBe(result.before);
});

test("手机设置保持点击外部关闭的行为", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const overlay = page.locator(".settings-overlay-mobile");
  await expect(overlay).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(overlay).toHaveCount(0);
});
