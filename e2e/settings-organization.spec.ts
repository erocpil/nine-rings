import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

async function settings(page: Page) {
  await page.keyboard.press("Alt+,");
  await expect(page.getByLabel("查找设置")).toBeVisible();
}

for (const width of [390, 1280]) test(`设置提示不改变主题和折叠选项布局 ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const measure = () => page.locator('.settings-body').evaluate(element => ({
    height: element.scrollHeight,
    themes: [...element.querySelectorAll('[aria-label="主题"] button')].map(button => {
      const r = button.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }),
  }));
  const before = await measure();
  await page.getByTitle("深色", { exact: true }).click();
  await expect(page.locator('.settings-toast')).toHaveText("已更新");
  expect(await measure()).toEqual(before);
  await expect(page.locator('.settings-toast')).toHaveCount(0, { timeout: 6000 });
  expect(await measure()).toEqual(before);
  await page.getByLabel("返回设置分类").click();
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  const fold = page.locator('[data-settings-label="折叠标识"]');
  await fold.scrollIntoViewIfNeeded();
  const geometry = () => fold.evaluate(element => {
    const body = element.closest('.settings-body')!;
    const r = element.getBoundingClientRect(); return { y: r.y, height: r.height, scrollHeight: body.scrollHeight };
  });
  const initial = await geometry();
  await page.getByLabel("折叠标识样式").selectOption("triangle");
  await expect(page.locator('.settings-toast')).toHaveText("已更新");
  expect(await geometry()).toEqual(initial);
  await expect(page.getByLabel("折叠标识样式")).toBeInViewport();
  await page.getByLabel("关闭提示", { exact: true }).click();
  expect(await geometry()).toEqual(initial);
});

test("设置搜索定位具体选项，手机返回与右滑遵循分类层级", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settings(page);
  await page.getByLabel("查找设置").fill("折叠标识");
  await page.locator('.settings-search-results').getByRole('button', { name: /^折叠标识/ }).click();
  await expect(page.locator('[data-settings-label="折叠标识"]')).toBeFocused();
  await expect(page.getByLabel("折叠标识样式")).toBeInViewport();
  await page.getByLabel("返回设置分类").click();
  await page.getByLabel("清除设置查找").click();
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole("button", { name: /打开 Vim 设置/ }).click();
  await page.locator('.settings-panel').evaluate(element => {
    for (const [type, x] of [["touchstart", 10], ["touchmove", 130], ["touchend", 130]] as const) {
      const touch = { identifier: 1, clientX: x, clientY: 130 };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    }
  });
  await expect(page.getByRole('heading', { name: '编辑器', exact: true })).toBeVisible();
  await page.getByLabel("返回设置分类").click();
  await expect(page.getByLabel("查找设置")).toBeVisible();
});

test("排版应用失败保留草稿及原有块显示设置，重试完整保存", async ({ page }) => {
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  const before = await page.evaluate(() => [localStorage.getItem('nr:blockWorkspaceDisplay'), localStorage.getItem('nr:codeBlockHeightPercent')]);
  await page.getByRole('button', { name: '增大正文与标题字号' }).click();
  await page.getByLabel('Tab 显示宽度').selectOption('8');
  await page.getByLabel('正文代码最大高度').selectOption('40');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'nine_rings_config') { Storage.prototype.setItem = original; throw new Error('模拟配置写入失败'); }
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '应用到编辑器' }).click();
  await expect(page.getByRole('dialog', { name: '排版设置' }).getByRole('status')).toContainText('保存失败');
  expect(await page.evaluate(() => [localStorage.getItem('nr:blockWorkspaceDisplay'), localStorage.getItem('nr:codeBlockHeightPercent')])).toEqual(before);
  await expect(page.getByLabel('Tab 显示宽度')).toHaveValue('8');
  await page.getByRole('button', { name: '应用到编辑器' }).click();
  await expect(page.getByRole('dialog', { name: '排版设置' })).toHaveCount(0);
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await expect(page.getByLabel('Tab 显示宽度')).toHaveValue('8');
  await expect(page.getByLabel('正文代码最大高度')).toHaveValue('40');
});

for (const mode of ["full", "source", "virtual"]) test(`集中书签打开并定位只读正文 ${mode}`, async ({ page }) => {
  await createBlankDocument(page);
  await page.locator('.note-title').fill('书签目标文档');
  const editor = page.locator('.ProseMirror');
  await editor.evaluate(element => {
    const ed = (element as HTMLElement & { editor: Editor }).editor;
    ed.commands.setContent({ type: 'doc', content: Array.from({ length: 100 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `目标段落 ${i}` }] })) }, true);
    let target = 1;
    ed.state.doc.forEach((_node, pos, index) => { if (index === 80) target = pos + 1; });
    ed.commands.setTextSelection(target);
    ed.view.focus();
  });
  await page.keyboard.press('Control+Shift+m');
  await expect(page.locator('.save-status-saved')).toBeVisible();
  await page.getByRole('button', { name: '点击设为只读', exact: true }).click();
  if (mode === "source") {
    await page.getByTitle("切换到 Markdown 源码").click();
    await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Markdown 源码", exact: true }).evaluate(element => { element.scrollTop = 0; });
  } else {
    if (mode === "virtual") await page.evaluate(() => localStorage.setItem("nr:experimentalReadonlyRendering", "true"));
    await createBlankDocument(page);
  }
  await settings(page);
  await page.getByRole('button', { name: /^文档管理/ }).click();
  await page.getByRole('button', { name: /^书签.*查看/ }).click();
  await page.getByRole('button', { name: '目标段落 80', exact: true }).click();
  await expect(page.locator('.settings-overlay')).toHaveCount(0);
  if (mode === "virtual") {
    await expect(page.locator('[data-virtual-reader]')).toBeVisible();
    await expect(page.locator('.vr-body').getByText('目标段落 80', { exact: true })).toBeInViewport();
    return;
  }
  await expect(page.locator('.note-title')).toHaveValue('书签目标文档');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.selection.$head.parent.textContent)).toBe('目标段落 80');
  await expect(editor.getByText('目标段落 80', { exact: true })).toBeInViewport();
});

test("只读切换反馈不覆盖标题或改变完成切换后的布局", async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  for (const name of ['点击设为只读', '点击设为可编辑']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.readonly-change-confirmed')).toHaveCount(1);
    const measure = () => page.locator('.note-title-row').evaluate(element => {
      const title = element.querySelector('.note-title-field')!.getBoundingClientRect();
      return [title.x, title.y, title.width, title.height, element.getBoundingClientRect().height];
    });
    const before = await measure();
    await expect(page.locator('.readonly-change-confirmed')).toHaveCount(0, { timeout: 5000 });
    expect(await measure()).toEqual(before);
  }
});
