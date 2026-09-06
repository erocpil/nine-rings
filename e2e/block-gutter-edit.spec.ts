import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

test("触摸代码块后的加号插入后不残留高亮，键盘布局变化仍对齐块间隙", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.fill("Is this role primarily focused on Spectrum/Quantum switch ASIC SDK development?");
  await page.getByRole("button", { name: "块 ▾", exact: true }).click();
  await page.getByRole("button", { name: "⏹ 代码块", exact: true }).click();
  await expect(editor.locator(".code-block-wrap")).toHaveCount(1);
  await expect(editor.locator(":scope > *")).toHaveCount(1);
  await page.locator(".note-title-row").getByTitle("专注模式").click();

  const insert = page.getByRole("button", { name: "在第 1 块后插入段落", exact: true });
  await insert.tap();
  await expect(editor.locator(":scope > *")).toHaveCount(2);
  await expect(editor).toBeFocused();
  // Model the keyboard's viewport shrink without dismissing it to clear the button.
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--app-viewport-height", "460px");
    document.documentElement.style.setProperty("--app-visual-viewport-bottom-inset", "300px");
    document.documentElement.classList.add("web-keyboard-open");
  });
  await expect(insert).toHaveCSS("-webkit-tap-highlight-color", "rgba(0, 0, 0, 0)");
  await expect(insert).toHaveCSS("appearance", "none");
  await expect(insert).toHaveCSS("width", "22px");
  await expect(insert).toHaveCSS("opacity", "0.12");
  await expect(page.locator(".editor-block-insert")).toHaveCount(3);
  await expect.poll(() => insert.evaluate((button) => {
    const code = document.querySelector(".ProseMirror > *")!.getBoundingClientRect();
    const paragraph = document.querySelector(".ProseMirror > p")!.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return Math.abs(rect.top + rect.height / 2 - (code.bottom + paragraph.top) / 2);
  })).toBeLessThan(2);

  // Force an emulated/sticky hover on a touch device; it must not look pressed.
  await insert.hover();
  await expect(insert).toHaveCSS("opacity", "0.12");
  await insert.tap();
  await expect(editor.locator(":scope > *")).toHaveCount(3);
  await expect(editor).toBeFocused();
  await expect(insert).toHaveCSS("opacity", "0.12");
  await expect(page.locator(".editor-block-insert")).toHaveCount(4);
});

test.describe("桌面加号状态", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false });

  test("鼠标悬停和键盘导航仍显示加号反馈", async ({ page }) => {
    await page.goto("/");
    const insert = page.getByRole("button", { name: "在第一块前插入段落", exact: true });
    await insert.hover();
    await expect(insert).toHaveCSS("opacity", "1");
    await page.mouse.move(800, 40);
    await page.keyboard.press("Tab");
    await insert.focus();
    await expect(insert).toBeFocused();
    await expect(insert).toHaveCSS("opacity", "1");
    await expect.poll(() => insert.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
  });
});

for (const delayedObserver of [false, true]) {
  test(`手机键盘打开时删除末尾空块立即更新块号${delayedObserver ? "（DOM 通知延迟）" : ""}`, async ({ page }) => {
    await page.addInitScript((delay) => {
      localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
      if (!delay) return;
      // 只延迟 gutter 的顶层 childList 观察器，不干扰 ProseMirror 读取原生输入。
      const NativeObserver = window.MutationObserver;
      window.MutationObserver = class extends NativeObserver {
        private gutter = false;
        constructor(callback: MutationCallback) {
          super((records, observer) => {
            if (this.gutter) window.setTimeout(() => callback(records, observer), 2000);
            else callback(records, observer);
          });
        }
        observe(target: Node, options?: MutationObserverInit) {
          this.gutter = target instanceof HTMLElement && target.classList.contains("ProseMirror")
            && !!options?.childList && !options.subtree;
          super.observe(target, options);
        }
      };
    }, delayedObserver);
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 19 }, (_, i) => `正文 ${i + 1}`).join("\n"));
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("Enter");
    await editor.press("Enter");
    await expect(editor.locator(":scope > *")).toHaveCount(22);
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await editor.locator(":scope > *").last().click();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-viewport-height", "460px");
      document.documentElement.style.setProperty("--app-visual-viewport-bottom-inset", "300px");
      document.documentElement.classList.add("web-keyboard-open");
    });
    const number = (index: number) => page.locator(`.editor-block-number[data-block-index="${index}"]`);
    await expect(number(22)).toHaveCount(1);
    // 先排空初始化时的延迟通知，再保持视口与键盘状态不变进行删除。
    if (delayedObserver) await page.waitForTimeout(2200);
    for (const remaining of [21, 20, 19]) {
      await page.keyboard.press("Backspace");
      await expect(editor.locator(":scope > *")).toHaveCount(remaining);
      await expect(number(remaining + 1)).toHaveCount(0, { timeout: 700 });
      await expect(number(remaining)).toHaveClass(/active/);
      await expect(page.getByRole("button", { name: `在第 ${remaining + 1} 块后插入段落`, exact: true })).toHaveCount(0);
      await expect(editor).toBeFocused();
      await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
    }
    await page.keyboard.press("Enter");
    await expect(editor.locator(":scope > *")).toHaveCount(20);
    await expect(number(20)).toHaveClass(/active/, { timeout: 700 });
    // 再覆盖浏览器原生编辑路径（不发 keydown），而非只测桌面快捷键。
    await editor.evaluate(() => document.execCommand("delete"));
    await expect(editor.locator(":scope > *")).toHaveCount(19);
    await expect(number(20)).toHaveCount(0, { timeout: 700 });
    await expect(number(19)).toHaveClass(/active/);
    await expect(editor.locator(":scope > *").last()).toHaveText("正文 19");
    await expect(editor).toBeFocused();
    await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
  });
}
