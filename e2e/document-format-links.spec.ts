import { sourceInfo, replaceSource } from "./helpers/source-editor";
import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, options: { text?: boolean; readonly?: boolean; virtual?: boolean; legacy?: boolean } = {}) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15000 });
  const id = await page.evaluate(async options => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const input = buildTextImportInput({ fileName: options.text ? "多行文本.txt" : "源码测试.md", source: options.text ? "首行\r\n\r\n# 原样标题\r末行\n" : "# 源码测试\n\n第一段 **粗体**\n\n[测试链接](https://example.org/path?q=1&x=2)\n\n最后一段\n" }, { mode: "document", storagePath: "references/格式测试", date: useNotesStore.getState().currentDate });
    if (options.legacy) input.content = { ops: [{ insert: "首行\r\n\r\n# 原样标题\r末行\n" }] };
    const note = await api.notes.create(input);
    if (options.readonly) await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote(await api.notes.get(note.id));
    localStorage.setItem("nr:experimentalReadonlyRendering", String(Boolean(options.virtual)));
    return note.id;
  }, options);
  await expect(page.locator(".editor-content")).toContainText(options.text || options.legacy ? "首行" : "最后一段");
  await page.reload();
  await expect(page.locator(".editor-content")).toContainText(options.text || options.legacy ? "首行" : "最后一段");
  return id;
}

test("TXT 换行/空行及独立图标，历史合并文本片段兼容", async ({ page }) => {
  await fixture(page, { text: true });
  await expect(page.locator(".ProseMirror p")).toHaveText(["首行", "", "# 原样标题", "末行"]);
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "多行文本" }).getByTitle("纯文本文档")).toHaveText("📄");
  await expect(page.getByRole("button", { name: "源码", exact: true })).toHaveCount(0);
  await fixture(page, { legacy: true });
  await expect(page.locator(".ProseMirror p")).toHaveText(["首行", "", "# 原样标题", "末行"]);
});

for (const mobile of [false, true]) {
  test(`Markdown 双向同步、快速切换和重新加载 ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    const id = await fixture(page);
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    }
    await expect(page.locator(".markdown-view-toolbar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(源码|渲染)$/ })).toHaveCount(1);
    const titleRow = page.locator(".note-title-row");
    const toggleBox = (await titleRow.getByRole("button", { name: "源码", exact: true }).boundingBox())!;
    const outlineBox = (await titleRow.getByRole("button", { name: "文档目录", exact: true }).boundingBox())!;
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(outlineBox.x + 1);
    expect(Math.abs(toggleBox.y - outlineBox.y)).toBeLessThan(10);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await expect.poll(async () => (await sourceInfo(source)).value).toMatch(/最后一段\n$/);
    await expect(page.locator(".note-title-row").getByRole("button", { name: "渲染", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(源码|渲染)$/ })).toHaveCount(1);
    await expect(page.locator(".ProseMirror")).toHaveCount(0);
    await replaceSource(source, "# 新标题\n\n**源码修改**\n\n[链接](https://example.org/)\n");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(page.locator(".ProseMirror strong")).toHaveText("源码修改");
    await expect(source).toHaveCount(0);
    await page.locator(".ProseMirror strong").click();
    await page.locator(".ProseMirror").press("Control+End");
    await page.keyboard.type(" rendered-edit");
    await expect(page.locator(".ProseMirror")).toContainText("rendered-edit");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(source)).value).toMatch(/rendered-edit/);
    await replaceSource(source, "# 持久保存\n\n源码最后修改\n");
    await expect.poll(() => page.evaluate(async id => {
      const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
      return (await api.notes.get(id))?.content.metadata?.markdownSource;
    }, id)).toBe("# 持久保存\n\n源码最后修改\n");
    await page.reload();
    await expect(source).toBeVisible();
    await expect.poll(async () => (await sourceInfo(source)).value).toEqual("# 持久保存\n\n源码最后修改\n");
  });
}

test("仅切换视图不改写导入源码或文档，源码遵守只读", async ({ page }) => {
  const id = await fixture(page, { readonly: true });
  const read = () => page.evaluate(async id => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    return (await api.notes.get(id))?.content;
  }, id);
  const before = await read();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect((await sourceInfo(page.getByRole("textbox", { name: "Markdown 源码", exact: true }))).readonly).toBe(true);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  expect(await read()).toEqual(before);
});

for (const virtual of [false, true]) {
  test(`专注模式标题栏只有一个源码切换按钮 ${virtual ? "virtual" : "full"}`, async ({ page }) => {
    await fixture(page, { readonly: true, virtual });
    await page.getByRole("button", { name: "专注模式", exact: true }).click();
    const toggle = page.getByRole("button", { name: "源码", exact: true });
    await expect(toggle).toBeVisible();
    await expect(page.getByRole("button", { name: /^(源码|渲染)$/ })).toHaveCount(1);
    const bounds = (await toggle.boundingBox())!;
    const outline = (await page.getByRole("button", { name: "文档目录", exact: true }).boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(outline.x + 1);
    await toggle.click();
    await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(toggle).toBeVisible();
    await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
  });
  test(`只读 Ctrl+A 仅选中全文，重复全选不扩散 ${virtual ? "virtual" : "full"}`, async ({ page }) => {
    await fixture(page, { readonly: true, virtual });
    await page.locator(".editor-content p").filter({ hasText: "第一段" }).click();
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Control+a");
      await expect.poll(() => page.evaluate(() => {
        const selection = window.getSelection();
        return { text: selection?.toString(), inside: !!selection?.anchorNode && !!selection.focusNode && !!document.querySelector(".editor-content")?.contains(selection.anchorNode) && !!document.querySelector(".editor-content")?.contains(selection.focusNode) };
      })).toMatchObject({ text: expect.stringContaining("最后一段"), inside: true });
    }
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await source.focus(); await source.press("Control+a");
    expect(await sourceInfo(source).then(info => info.selectionEnd - info.selectionStart)).toBeGreaterThan(20);
  });
}

test("链接右键菜单、复制、打开和窗口边界", async ({ page }) => {
  await fixture(page, { readonly: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { document.body.dataset.copiedLink = text; } } });
    window.open = (url, _target, features) => { document.body.dataset.openedLink = String(url); document.body.dataset.openFeatures = features; return null; };
  });
  const link = page.locator(".editor-content a");
  await link.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "链接操作" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "复制链接" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已复制链接" })).toBeVisible();
  expect(await page.locator("body").getAttribute("data-copied-link")).toBe("https://example.org/path?q=1&x=2");
  await link.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "打开链接", exact: true }).click();
  expect(await page.locator("body").getAttribute("data-opened-link")).toContain("example.org");
  await link.dispatchEvent("contextmenu", { clientX: 1278, clientY: 798 });
  const box = (await menu.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  await menu.getByRole("menuitem", { name: "在新窗口打开" }).click();
  expect(await page.locator("body").getAttribute("data-open-features")).toContain("popup=yes");
  await link.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test.describe("手机链接", () => {
  test.use({ hasTouch: true });
  test("长按打开菜单、滑动取消、松手不会跳转", async ({ page }) => {
    await fixture(page, { readonly: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    const link = page.locator(".editor-content a");
    const menu = page.getByRole("menu", { name: "链接操作" });
    await link.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 200 });
    await link.dispatchEvent("pointermove", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 240 });
    await page.waitForTimeout(650);
    await expect(menu).toHaveCount(0);
    await link.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 200 });
    await expect(menu).toBeVisible();
    await link.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 200 });
    const cancelled = await link.evaluate(el => !el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(cancelled).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});
