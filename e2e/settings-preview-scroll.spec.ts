import { settingsBackdropFilter } from "./helpers/settings";
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
  await page.getByRole("button", { name: "源码微渲染", exact: true }).click();
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
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(2px)");
  await expect(overlay).toHaveCSS("transition-duration", "0.18s, 0.18s, 0.18s");
  await page.mouse.click(8, 500);
  await expect(overlay).toHaveCount(1);
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(0px)");
  await page.mouse.move(800, 500);
  await expect(overlay).toHaveCSS("opacity", "0");
  await page.mouse.up();
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(2px)");
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

test("排版设置按住外部预览，释放恢复且保留草稿", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "排版临时预览");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  const appearance = page.getByRole("dialog", { name: "排版设置", exact: true });
  const overlay = page.locator(".settings-overlay");
  const size = appearance.getByLabel("H1 字号", { exact: true });
  await size.selectOption("40");
  await page.mouse.click(8, 500);
  await expect(appearance).toBeVisible();
  await expect(size).toHaveValue("40");
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(0px)");
  await page.mouse.move(800, 500);
  await page.mouse.up();
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(2px)");
  await expect(appearance).toBeVisible();
  await expect(size).toHaveValue("40");
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(overlay).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await expect(size).toHaveValue("40");
});

test("插件配置按住外部预览完整工作区，释放和失焦恢复配置", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "插件配置临时预览");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^高级/ }).click();
  await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
  await page.getByRole("button", { name: "编号展示", exact: true }).click();
  const overlay = page.locator(".settings-overlay");
  const dialog = page.getByRole("dialog", { name: "编号展示配置", exact: true });
  const bold = dialog.getByRole("checkbox", { name: "编号粗体", exact: true });
  if (!await bold.isChecked()) await bold.check();
  await page.mouse.click(8, 500);
  await expect(dialog).toBeVisible();
  await expect(bold).toBeChecked();

  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(dialog).toHaveCSS("opacity", "0");
  await expect(overlay).toHaveCSS("opacity", "0");
  await expect.poll(() => dialog.evaluate(element => {
    const style = getComputedStyle(element, "::backdrop");
    return style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter");
  })).toMatch(/blur\((?:0|0px)\)/);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.mouse.up();
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect(bold).toBeChecked();

  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(dialog).toHaveCSS("opacity", "0");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(overlay).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await expect(bold).toBeChecked();
});

test("设置子页面按住外围可预览完整工作区，松开后保持子页", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await createBlankDocument(page, "子设置页预览");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^系统信息/ }).click();
  const overlay = page.locator(".settings-overlay");
  await expect(page.getByRole("heading", { name: "系统信息", exact: true })).toBeVisible();
  await expect(page.locator(".system-information-grid")).toContainText("文档数量");
  await expect(page.locator(".system-information-grid")).toContainText("全部文档正文大小");
  await expect(page.getByRole("tree", { name: "按路径汇总的文档信息" })).toBeVisible();
  const information = page.locator(".settings-system-information > .settings-section");
  const infoLeft = await information.nth(0).boundingBox();
  const infoRight = await information.nth(1).boundingBox();
  expect(infoRight!.x).toBeGreaterThan(infoLeft!.x + infoLeft!.width);
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(0px)");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.mouse.up();
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(2px)");
  await expect(page.getByRole("heading", { name: "系统信息", exact: true })).toBeVisible();
});

test("系统信息在手机宽度改为单列", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createBlankDocument(page, "手机系统信息布局");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.keyboard.press("Alt+,");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^系统信息/ }).click();
  const information = page.locator(".settings-system-information > .settings-section");
  await expect(information).toHaveCount(2);
  const first = await information.nth(0).boundingBox();
  const second = await information.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);
  await expect.poll(() => page.locator(".settings-body").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

test("减少动态效果时设置预览关闭过渡，按住和松开仍可使用", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createBlankDocument(page);
  await page.getByTitle("设置", { exact: true }).click();
  const overlay = page.locator(".settings-overlay");
  await expect.poll(() => overlay.evaluate(element =>
    Math.max(...getComputedStyle(element).transitionDuration.split(",").map(parseFloat)),
  )).toBeLessThan(0.001);
  await page.mouse.move(8, 500);
  await page.mouse.down();
  await expect(overlay).toHaveCSS("opacity", "0");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(0px)");
  await page.mouse.up();
  await expect(overlay).toHaveCSS("opacity", "1");
  await expect.poll(() => settingsBackdropFilter(overlay)).toBe("blur(2px)");
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
  await expect.poll(async () => (await overlay.locator(".settings-panel").boundingBox())!.x).toBeGreaterThan(16);
  const box = (await overlay.locator(".settings-panel").boundingBox())!;
  await page.mouse.click(box.x / 2, 8);
  await expect(overlay).toHaveCount(0);
});
