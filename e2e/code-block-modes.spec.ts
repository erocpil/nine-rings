import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

async function codeDocument(page: Page) {
  await createBlankDocument(page);
  await page.locator('.note-editor .ProseMirror').evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'typescript', title: '示例' }, content: [{ type: 'text', text: 'alpha\nbeta\ngamma' }] }] }, true);
  });
  return page.locator('.note-editor .code-block-wrap');
}

test('只读代码块显示语言且不可修改，弹层保持相同语言', async ({ page }) => {
  const block = await codeDocument(page);
  await page.getByRole('button', { name: '点击设为只读', exact: true }).click();
  await expect(block.getByLabel('代码语言')).toBeVisible();
  await expect(block.getByLabel('代码语言')).toBeDisabled();
  await expect(block.getByLabel('代码语言')).toHaveValue('typescript');
  const editor = page.locator('.note-editor .ProseMirror');
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setTextSelection(1);
    instance.view.focus();
  });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Control+Enter');
  await expect(block.locator('pre code')).toHaveText('alpha\nbeta\ngamma');
  await expect(editor.locator(':scope > p')).toHaveCount(0);
  await block.getByRole('button', { name: '放大阅读代码块' }).click();
  const dialog = page.getByRole('dialog', { name: '代码块工作区' });
  await expect(dialog.getByLabel('代码语言')).toBeVisible();
  await expect(dialog.getByLabel('代码语言')).toBeDisabled();
  await expect(dialog.getByLabel('代码语言')).toHaveValue('typescript');
  await expect(dialog.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
});

test('代码块编辑可直接使用 Vim，插入换行退格、可视模式和撤销重做生效', async ({ page }) => {
  const block = await codeDocument(page);
  await block.getByRole('button', { name: '放大阅读代码块' }).click();
  const dialog = page.getByRole('dialog', { name: '代码块工作区' });
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  const code = dialog.locator('.cm-content');
  await expect(code).toBeFocused();
  await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM NORMAL');
  await page.keyboard.type('ggi');
  await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM INSERT');
  await page.keyboard.type('test');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await expect(block.locator('pre code')).toHaveText('test\nalpha\nbeta\ngamma');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM NORMAL');
  await page.keyboard.press('u');
  await expect(block.locator('pre code')).toHaveText('alpha\nbeta\ngamma');
  await page.keyboard.press('Control+r');
  await expect(block.locator('pre code')).toHaveText('test\nalpha\nbeta\ngamma');
  await page.keyboard.type('ggVj');
  await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM VISUAL');
  await expect(dialog.locator('.cm-selectionBackground').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await dialog.getByLabel('代码语言').focus();
  await dialog.getByLabel('代码语言').selectOption('python');
  await dialog.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(dialog.getByLabel('代码语言')).toBeDisabled();
  await expect(dialog.getByLabel('代码语言')).toHaveValue('python');
  await dialog.getByRole('button', { name: '关闭块工作区' }).click();
  await expect(block.getByLabel('代码语言')).toHaveValue('python');
  await page.reload();
  await expect(page.locator('.note-editor pre code')).toHaveText('test\nalpha\nbeta\ngamma');
});

test('代码行号在正文、弹层阅读与 Vim 编辑之间同步并持久化', async ({ page }) => {
  const block = await codeDocument(page);
  await block.getByRole('button', { name: '显示代码行号', exact: true }).click();
  await expect(block.locator('.code-block-gutter')).toBeVisible();
  await block.getByRole('button', { name: '放大阅读代码块' }).click();
  const dialog = page.getByRole('dialog', { name: '代码块工作区' });
  await expect(dialog.locator('.code-block-gutter')).toBeVisible();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(dialog.locator('.cm-lineNumbers')).toBeVisible();
  await page.keyboard.press('i');
  await dialog.getByRole('button', { name: '隐藏代码行号', exact: true }).click();
  await expect(dialog.locator('.cm-lineNumbers')).toHaveCount(0);
  await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM INSERT');
  await expect(block.locator('.code-block-gutter')).toBeHidden();
  await dialog.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(dialog.locator('.code-block-gutter')).toBeHidden();
  await dialog.getByRole('button', { name: '显示代码行号', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭块工作区' }).click();
  await page.reload();
  await expect(page.locator('.note-editor .code-block-gutter')).toBeVisible();
  await page.keyboard.press('Alt+,');
  await page.getByRole('button', { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole('button', { name: /打开排版设置/ }).click();
  await expect(page.getByRole('checkbox', { name: '显示代码行号', exact: true })).toBeChecked();
});

test('已有正文行号设置优先于旧弹层偏好，虚拟只读也显示语言和行号', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nr:codeLineNumbers', 'true');
    localStorage.setItem('nr:blockWorkspaceDisplay', '{"lineNumbers":false}');
    localStorage.setItem('nr:experimentalReadonlyRendering', 'true');
  });
  const block = await codeDocument(page);
  await expect(block.locator('.code-block-gutter')).toBeVisible();
  await block.getByRole('button', { name: '放大阅读代码块' }).click();
  const dialog = page.getByRole('dialog', { name: '代码块工作区' });
  await expect(dialog.locator('.code-block-gutter')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭块工作区' }).click();
  await page.getByRole('button', { name: '点击设为只读', exact: true }).click();
  const reader = page.locator('[data-virtual-reader]');
  await expect(reader).toBeVisible();
  await expect(reader.getByLabel('代码语言')).toHaveText('TypeScript');
  await expect(reader.locator('.vr-code-line-number')).toHaveCount(3);
  await reader.getByRole('button', { name: '隐藏代码行号', exact: true }).click();
  await expect(reader.locator('.vr-code-line-number')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('nr:codeLineNumbers'))).toBe('false');
});

for (const mac of [false, true]) {
  test(`正文代码 Tab 缩进、选中行缩进与组合键退出 ${mac ? 'Mac' : 'Windows'}`, async ({ page }) => {
    if (mac) await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }));
    const block = await codeDocument(page);
    const editor = page.locator('.note-editor .ProseMirror');
    await editor.evaluate(element => {
      const instance = (element as HTMLElement & { editor: Editor }).editor;
      instance.commands.setTextSelection({ from: 1, to: 7 }); // End at the next line's start.
      instance.view.focus();
    });
    await page.keyboard.press('Tab');
    await expect(block.locator('pre code')).toHaveText('\talpha\nbeta\ngamma');
    await page.keyboard.press('Shift+Tab');
    await expect(block.locator('pre code')).toHaveText('alpha\nbeta\ngamma');
    await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(1));
    await page.keyboard.press('Shift+Tab'); // No indentation to remove: keep focus.
    await expect(editor).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(block.locator('pre code')).toHaveText('\t\talpha\nbeta\ngamma');
    await expect(editor).toBeFocused();
    expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.doc.firstChild?.attrs.indent)).toBe(0);
    await page.keyboard.press(mac ? 'Meta+Enter' : 'Control+Enter');
    await page.keyboard.type('outside');
    await expect(editor.locator(':scope > p')).toHaveText('outside');
    await expect(block.locator('pre code')).toHaveText('\t\talpha\nbeta\ngamma');
  });

  test(`Vim 退出插入模式后 Tab 仍缩进，组合键关闭弹层并回到正文 ${mac ? 'Mac' : 'Windows'}`, async ({ page }) => {
    if (mac) await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }));
    const block = await codeDocument(page);
    await block.getByRole('button', { name: '放大阅读代码块' }).click();
    const dialog = page.getByRole('dialog', { name: '代码块工作区' });
    await dialog.getByRole('button', { name: '编辑', exact: true }).click();
    const code = dialog.locator('.cm-content');
    await page.keyboard.type('ggi');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect(code).toBeFocused();
    await expect(block.locator('pre code')).toHaveText('\t\talpha\nbeta\ngamma');
    await expect(dialog.locator('.block-workspace-vim-mode')).toHaveText('VIM NORMAL');
    await page.keyboard.press('Shift+Tab');
    await expect(block.locator('pre code')).toHaveText('\talpha\nbeta\ngamma');
    await page.keyboard.type('ggVj');
    await page.keyboard.press('Tab');
    await expect(block.locator('pre code')).toHaveText('\t\talpha\n\tbeta\ngamma');
    await page.keyboard.press('Shift+Tab');
    await expect(block.locator('pre code')).toHaveText('\talpha\nbeta\ngamma');
    await page.keyboard.press('Escape');
    await page.keyboard.press(mac ? 'Meta+Enter' : 'Control+Enter');
    await expect(dialog).toHaveCount(0);
    const editor = page.locator('.note-editor .ProseMirror');
    await expect(editor).toBeFocused();
    await page.keyboard.type('outside');
    await expect(editor.locator(':scope > p')).toHaveText('outside');
    await expect(block.locator('pre code')).toHaveText('\talpha\nbeta\ngamma');
  });
}
