import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { replaceSource, scrollSourceTo } from "./helpers/source-editor";

test("源码已在中部时打开或重新开启预览同步，不停留在文档开头", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "打开预览对齐当前位置");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const split = page.getByRole("button", { name: "并排预览", exact: true });
  if (await split.getAttribute("aria-pressed") === "true") await split.click();
  await replaceSource(area, Array.from({ length: 80 }, (_, i) => `## 同步章节 ${i}\n\n${"正文用于验证同步。".repeat(8)}`).join("\n\n"));
  await scrollSourceTo(area, "## 同步章节 40");
  await split.click();
  const preview = page.locator(".markdown-preview-scroll");
  const heading = preview.getByRole("heading", { name: "同步章节 40", exact: true });
  const distance = () => heading.evaluate(element => Math.abs(element.getBoundingClientRect().top - element.closest(".markdown-preview-scroll")!.getBoundingClientRect().top));
  await expect.poll(distance).toBeLessThan(65);
  // Model content above the current block gaining height after image/math layout.
  await preview.locator(".ProseMirror").evaluate(element => { element.style.paddingTop = "260px"; });
  await expect.poll(distance).toBeLessThan(65);
  await split.click();
  await split.click();
  await expect.poll(distance).toBeLessThan(65);
  const sync = page.getByRole("checkbox", { name: "同步滚动", exact: true });
  await sync.uncheck();
  await scrollSourceTo(area, "## 同步章节 60");
  await sync.check();
  const next = preview.getByRole("heading", { name: "同步章节 60", exact: true });
  await expect.poll(() => next.evaluate(element => Math.abs(element.getBoundingClientRect().top - element.closest(".markdown-preview-scroll")!.getBoundingClientRect().top))).toBeLessThan(65);
});

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
