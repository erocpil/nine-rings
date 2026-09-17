import { expect, test, type Page } from "@playwright/test";

async function openTestNote(page: Page, paragraphs = [""]) {
  await expect(page.locator(".ProseMirror")).toBeVisible();
  // Isolate native editing from asynchronous welcome-note hydration.
  await page.evaluate(async (lines) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({ title: "块号测试", date: useNotesStore.getState().currentDate,
      content: { ops: lines.flatMap((line) => line ? [{ insert: line }, { insert: "\n" }] : [{ insert: "\n" }]) },
    });
    useNotesStore.getState().selectNote(note);
  }, paragraphs);
  await expect(page.locator(".note-title")).toHaveValue("块号测试");
  await expect(page.locator(".ProseMirror > *")).toHaveCount(paragraphs.length);
}

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

test("触摸代码块后的加号插入后不残留高亮，键盘布局变化仍对齐块间隙", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
  });
  await page.goto("/");
  await openTestNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("Is this role primarily focused on Spectrum/Quantum switch ASIC SDK development?");
  await page.getByRole("button", { name: "块", exact: true }).click();
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
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 460 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
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
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
    await page.goto("/");
    await openTestNote(page, ["第一块", "第二块", "第三块", "第四块"]);
    const insert = page.getByRole("button", { name: "在第一块前插入段落", exact: true });
    await page.mouse.move(800, 40);
    await expect(insert).toHaveCSS("opacity", "0");
    const number = page.locator(".editor-block-number").first();
    await number.hover();
    await expect(insert).toHaveCSS("opacity", "0.55");
    const visibleInsertLabels = () => page.locator(".editor-block-insert").evaluateAll(buttons =>
      buttons.filter(button => Number(getComputedStyle(button).opacity) > 0).map(button => button.getAttribute("aria-label")));
    await expect.poll(visibleInsertLabels).toEqual(["在第一块前插入段落", "在第 1 块后插入段落"]);
    const label = await number.evaluate(element => {
      const style = getComputedStyle(element, "::after");
      return { right: style.right, padding: style.paddingRight, align: style.textAlign, visible: style.visibility };
    });
    expect(label).toEqual({ right: "-2px", padding: "0px", align: "right", visible: "visible" });
    await page.mouse.move(800, 40);
    await expect(insert).toHaveCSS("opacity", "0");
    await page.locator('.editor-block-number[data-block-index="3"]').hover();
    await expect.poll(visibleInsertLabels).toEqual(["在第 2 块后插入段落", "在第 3 块后插入段落"]);
    await page.getByRole("button", { name: "在第 3 块后插入段落", exact: true }).hover();
    await expect.poll(visibleInsertLabels).toEqual(["在第 2 块后插入段落", "在第 3 块后插入段落"]);
    await page.locator('.editor-block-number[data-block-index="4"]').hover();
    await expect.poll(visibleInsertLabels).toEqual(["在第 3 块后插入段落", "在第 4 块后插入段落"]);
    await number.hover();
    await insert.hover();
    await expect(insert).toHaveCSS("opacity", "1");
    await page.mouse.move(800, 40);
    await page.keyboard.press("Tab");
    await insert.focus();
    await expect(insert).toBeFocused();
    await expect(insert).toHaveCSS("opacity", "1");
    await expect.poll(() => insert.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
    await page.mouse.move(800, 40);
    await number.hover();
    await insert.click();
    await expect(page.locator(".ProseMirror > *")).toHaveCount(5);
  });

  test("不经过块号直接进入加号位置也显示对应块前后两个加号", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
    await page.goto("/");
    await openTestNote(page, ["第一块", "第二块", "第三块", "第四块"]);
    const visibleLabels = () => page.locator(".editor-block-insert").evaluateAll(buttons =>
      buttons.filter(button => Number(getComputedStyle(button).opacity) > 0).map(button => button.getAttribute("aria-label")));
    for (const [label, pair] of [
      ["在第一块前插入段落", ["在第一块前插入段落", "在第 1 块后插入段落"]],
      ["在第 3 块后插入段落", ["在第 2 块后插入段落", "在第 3 块后插入段落"]],
      ["在第 4 块后插入段落", ["在第 3 块后插入段落", "在第 4 块后插入段落"]],
    ] as const) {
      await page.mouse.move(800, 40);
      await expect.poll(visibleLabels).toEqual([]);
      const target = page.getByRole("button", { name: label, exact: true });
      const box = await target.boundingBox();
      if (!box) throw new Error("插入按钮没有布局位置");
      // One jump, no intermediate movement over the gutter/number. Exercise
      // the first button's upper half outside the gutter's own bounds too.
      await page.mouse.move(box.x + box.width / 2, box.y + 2);
      await expect.poll(visibleLabels).toEqual([...pair]);
      await expect(target).toHaveCSS("opacity", "1");
    }
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator(".ProseMirror > *")).toHaveCount(5);
  });
});

for (const width of [1280, 390]) {
  test(`单块文档的悬停类型标签完整显示且不遮挡正文（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
    await page.goto("/");
    await openTestNote(page, ["正文边界"]);
    const number = page.locator(".editor-block-number").first();
    await number.hover();
    // Exercise every label against the smallest possible (one-digit) gutter.
    for (const format of ["Text", "H1", "Quote", "UL", "OL", "Task", "Code", "HR", "Table", "Image", "Block"]) {
      const bounds = await number.evaluate((element, label) => {
        element.setAttribute("data-block-format", label);
        const style = getComputedStyle(element, "::after");
        const right = element.getBoundingClientRect().right - parseFloat(style.right);
        const shell = element.closest(".editor-content-shell")!;
        return {
          left: right - parseFloat(style.width), right,
          gutterLeft: shell.getBoundingClientRect().left,
          textLeft: shell.querySelector(".ProseMirror > p")!.getBoundingClientRect().left,
          visible: style.visibility,
        };
      }, format);
      expect(bounds.visible).toBe("visible");
      expect(bounds.left, `${format} must not clip on the left`).toBeGreaterThanOrEqual(bounds.gutterLeft);
      expect(bounds.right, `${format} must leave space before body text`).toBeLessThanOrEqual(bounds.textLeft - 2);
    }
  });
}

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
    await openTestNote(page, [...Array.from({ length: 19 }, (_, i) => `正文 ${i + 1}`), "", "", ""]);
    await expect(editor.locator(":scope > *")).toHaveCount(22);
    await page.locator(".note-title-row").getByTitle("专注模式").click();
    await editor.locator(":scope > *").last().click();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 460 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
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
