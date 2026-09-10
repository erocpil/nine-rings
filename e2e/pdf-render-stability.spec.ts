import { test, expect } from '@playwright/test';
import { createPdfFixture } from './helpers/reader-fixtures';

test('PDF 横向翻页能够完成渲染且不会循环更新', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'PDF / EPUB 阅读', exact: true }).click();
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
    name: 'render-stability.pdf', mimeType: 'application/pdf', buffer: createPdfFixture(),
  });
  for (const number of [1, 2, 1]) {
    await page.getByLabel('PDF 页码', { exact: true }).fill(String(number));
    await page.getByLabel('PDF 页码', { exact: true }).press('Enter');
    const canvas = page.locator(`.pdf-page-surface[data-pdf-page="${number}"] canvas`);
    await expect(canvas).toHaveAttribute('data-pdf-ready', 'true');
    await expect(canvas).toHaveAttribute('data-pdf-render-source', /^(render|cache)$/);
  }
  expect(errors).toEqual([]);
});
