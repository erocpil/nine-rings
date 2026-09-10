import { expect, test } from '@playwright/test';
import { createPdfFixture, createEpubFixture } from './helpers/reader-fixtures';

for (const format of ['pdf', 'epub'] as const) {
  test(`桌面侧栏 ${format} 阅读与正文编辑互不干扰`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', '当前 WebKit 测试环境不支持资料库 IndexedDB Blob 存储；导航与手机入口另行覆盖');
    await page.goto('/');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 25000 });
    await editor.fill('分栏编辑测试');
    await page.getByRole('button', { name: 'PDF / EPUB 阅读', exact: true }).click();
    await page.locator(`.desktop-reader-panel input[type=file][accept*=".${format}"]`).setInputFiles({
      name: `workspace.${format}`,
      mimeType: format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
      buffer: format === 'pdf' ? createPdfFixture() : createEpubFixture(),
    });
    const reader = page.getByLabel(`${format.toUpperCase()} 阅读器`, { exact: true });
    await expect(reader).toBeVisible();
    if (format === 'pdf') {
      await expect.poll(() => page.locator('.pdf-page-viewport canvas').first().getAttribute('width')).not.toBe('0');
    } else {
      await expect(page.locator('.epub-chapter-frame')).toBeVisible();
      expect((await page.locator('.epub-chapter-frame').boundingBox())!.width).toBeGreaterThan(300);
    }
    await expect.poll(() => reader.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${format}-workspace.png`) });
    await expect(editor).toBeVisible();
    const left = await reader.boundingBox();
    const right = await editor.boundingBox();
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' still editing');
    await page.keyboard.press('Escape');
    await expect(reader).toBeVisible();
    await expect(editor).toContainText('still editing');
    await page.getByRole('button', { name: '文档树', exact: true }).click();
    await expect(reader).toBeHidden();
    await page.getByRole('button', { name: 'PDF / EPUB 阅读', exact: true }).click();
    await expect(reader).toBeVisible();
    await expect(editor).toContainText('still editing');
    await expect.poll(() => page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load('/src/lib/api.ts') as typeof import('../src/lib/api');
      const { useNotesStore } = await load('/src/stores/useNotesStore.ts') as typeof import('../src/stores/useNotesStore');
      const note = await api.notes.get(useNotesStore.getState().selectedNote!.id);
      return JSON.stringify(note?.content).includes('still editing');
    })).toBe(true);
    await page.reload();
    await expect(editor).toContainText('still editing', { timeout: 25000 });
  });
}

test('手机仍使用原来的抽屉入口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('.desktop-activity-bar')).toHaveCount(0);
  await expect(page.locator('.desktop-reader-panel')).toHaveCount(0);
});
