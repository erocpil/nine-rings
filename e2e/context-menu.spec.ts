import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * 正文右键菜单（自定义上下文菜单）E2E 测试。
 *
 * 覆盖：
 *   1. 作用范围 —— onContextMenu 只绑定在 EditorContent，标题/标签/工具栏不应拦截
 *   2. 视口边界 —— 菜单渲染后经 useLayoutEffect clamp，右下角/底部右键不越界
 *   3. 菜单项显示与禁用 —— 有/无选区、只读模式下的菜单项差异
 *   4. 菜单命令行为 —— 实际点击“全选/剪切/插入链接”并验证编辑器内容变化
 */

// 新建一篇空白随笔，返回正文编辑器 locator
async function createBlankNote(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  return editor;
}

// 直接向编辑器派发 contextmenu（带指定 clientX/clientY），
// 跳过 mousedown，避免破坏 ProseMirror 的选区状态
async function dispatchContextMenu(editor: Locator, x: number, y: number): Promise<void> {
  await editor.evaluate((el, { x, y }) => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    );
  }, { x, y });
}

const menu = (page: Page) => page.locator(".editor-context-menu");
const item = (page: Page, text: string) =>
  page.locator(".editor-context-item", { hasText: text });

test.describe("正文右键菜单：作用范围", () => {
  test("右键正文弹出自定义菜单", async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.click({ button: "right" });
    await expect(menu(page)).toBeVisible();
  });

  test("右键标题不弹出自定义菜单", async ({ page }) => {
    await createBlankNote(page);
    await page.locator(".note-title").click({ button: "right" });
    await expect(menu(page)).toHaveCount(0);
  });

  test("右键标签输入框不弹出自定义菜单", async ({ page }) => {
    await createBlankNote(page);
    await page.locator(".tag-input").click({ button: "right" });
    await expect(menu(page)).toHaveCount(0);
  });

  test("右键工具栏不弹出自定义菜单", async ({ page }) => {
    await createBlankNote(page);
    await page.locator(".editor-menu").click({ button: "right" });
    await expect(menu(page)).toHaveCount(0);
  });
});

test.describe("正文右键菜单：视口边界", () => {
  test("右下角右键时菜单完全落在视口内", async ({ page }) => {
    const editor = await createBlankNote(page);
    const vp = page.viewportSize()!;
    await dispatchContextMenu(editor, vp.width - 4, vp.height - 4);

    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  });

  test("视口底部右键时菜单不越界", async ({ page }) => {
    const editor = await createBlankNote(page);
    const vp = page.viewportSize()!;
    // 全选使菜单包含“插入链接”，逼近真实最长的菜单形态
    await editor.fill("选区文本");
    await editor.press("Control+A");
    await dispatchContextMenu(editor, vp.width / 2, vp.height - 2);

    const box = (await menu(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  });
});

test.describe("正文右键菜单：菜单项显示与禁用", () => {
  test("有选区时显示“插入链接”，无选区时不显示", async ({ page }) => {
    const editor = await createBlankNote(page);

    // 无选区：光标塌缩
    await editor.fill("测试文本");
    await dispatchContextMenu(editor, 120, 120);
    await expect(item(page, "插入链接")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 有选区：全选后右键，插入链接应出现
    await editor.click();
    await editor.press("Control+A");
    await dispatchContextMenu(editor, 120, 120);
    await expect(item(page, "插入链接")).toBeVisible();
  });

  test("无选区时“复制/剪切”禁用，“全选”可用", async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill("测试文本");
    await dispatchContextMenu(editor, 120, 120);

    await expect(item(page, "复制")).toBeDisabled();
    await expect(item(page, "剪切")).toBeDisabled();
    await expect(item(page, "全选")).toBeEnabled();
  });

  test("只读模式下仅保留“复制/全选”", async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill("只读文本");

    const readonlyButton = page.locator(".sidebar-item.active").getByTitle("设为只读");
    await readonlyButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await dispatchContextMenu(editor, 120, 120);
    await expect(menu(page)).toBeVisible();
    await expect(item(page, "复制")).toBeVisible();
    await expect(item(page, "全选")).toBeVisible();
    await expect(item(page, "撤销")).toHaveCount(0);
    await expect(item(page, "粘贴")).toHaveCount(0);
    await expect(item(page, "插入链接")).toHaveCount(0);
  });
});

test.describe("正文右键菜单：菜单命令行为", () => {
  test("点击“全选”选中全文", async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill("要全选的文本");
    await dispatchContextMenu(editor, 120, 120);
    await item(page, "全选").click();

    await expect
      .poll(() => editor.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe("要全选的文本");
  });

  test("点击“剪切”复制到剪贴板并清空选区内容", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const editor = await createBlankNote(page);
    await editor.fill("要剪切的文本");
    await editor.press("Control+A");
    await dispatchContextMenu(editor, 120, 120);
    await item(page, "剪切").click();

    // 剪切 = 写入剪贴板 + 删除选区，两段语义分别验证
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("要剪切的文本");
    await expect.poll(() => editor.textContent()).toBe("");
  });

  test("点击“插入链接”生成链接", async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill("要链接的文字");
    await editor.press("Control+A");
    await dispatchContextMenu(editor, 120, 120);
    await item(page, "插入链接").click();

    await expect(page.locator(".image-dialog-input")).toBeVisible();
    await page.locator(".image-dialog-input").fill("https://example.com");
    await page.locator(".image-dialog-actions .menu-btn.active").click();

    await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(editor.locator("a")).toHaveText("要链接的文字");
  });
});
