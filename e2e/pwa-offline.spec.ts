import { expect, test } from '@playwright/test';

test('生产 PWA 安装后可以离线冷启动并恢复本地编辑', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const title = page.locator('.note-title');
  await title.fill('PWA 离线恢复验证');
  await expect(page.locator('.save-status')).toHaveAttribute('title', /已保存/);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.web-status-banner.offline')).toContainText('当前离线');
  await expect(page.locator('.note-title')).toHaveValue('PWA 离线恢复验证');
  await expect(page.locator('.ProseMirror')).toBeEditable();
});
