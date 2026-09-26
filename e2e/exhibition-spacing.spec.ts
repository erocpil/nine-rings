import { expect, test } from '@playwright/test';

for (const status of [true, false]) {
  test(`手机展陈底部不重复留安全区，状态栏 ${status}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((status) => localStorage.setItem('nine_rings_config', JSON.stringify({ interface_style: 'minimal', workspace_layout: 'exhibition', editor_show_status_bar: status })), status);
    await page.goto('/');
    await page.addStyleTag({ content: ':root { --safe-bottom: 34px; }' });
    const sample = page.locator('.doc-tree-open').filter({ hasText: '物哀、幽玄与侘寂：风格设计与验证' });
    await expect(sample).toBeVisible();
    await sample.click();
    await page.setViewportSize({ width: 390, height: 844 });
    const overlay = page.locator(".sidebar-overlay.active");
    if (await overlay.isVisible()) await overlay.click({ position: { x: 380, y: 400 } });
    await expect(page.locator('.note-title')).toHaveValue('物哀、幽玄与侘寂：风格设计与验证');
    await expect(page.locator('.is-exhibition .app-main')).toHaveCSS('padding-bottom', '0px');
    await expect(page.locator('.note-editor .editor-stats')).toBeVisible({ visible: status });
    const gap = await page.evaluate(() => {
      const frame = document.querySelector('.is-exhibition > .app')!.getBoundingClientRect();
      const editor = document.querySelector('.note-editor')!.getBoundingClientRect();
      return frame.bottom - editor.bottom;
    });
    expect(gap).toBeLessThanOrEqual(5);
  });
}
test('桌面四栏沿工作区铺宽，下拉框保留无障碍名称', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('nine_rings_config', JSON.stringify({ interface_style: 'calm', workspace_layout: 'exhibition' })));
  await page.goto('/');
  await expect(page.locator('.exhibition-masthead')).toBeVisible();
  await expect(page.getByLabel('工作区风格')).toBeVisible();
  await expect(page.getByLabel('工作区配色')).toBeVisible();
  await expect(page.locator('.exhibition-appearance').getByText('风格', { exact: true })).toHaveCount(0);
  await expect(page.locator('.exhibition-appearance').getByText('配色', { exact: true })).toHaveCount(0);
  const widths = await page.evaluate(() => ({ overview: document.querySelector('.exhibition-overview')!.getBoundingClientRect().width, frame: document.querySelector('.is-exhibition > .app')!.getBoundingClientRect().width }));
  expect(widths.overview).toBeGreaterThan(1400);
  expect(Math.abs(widths.overview - widths.frame)).toBeLessThan(2);
});
