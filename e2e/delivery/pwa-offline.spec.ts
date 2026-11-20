import { expect, test } from '@playwright/test';

test('应用脚本尚未完成时也立即显示启动界面', async ({ page }) => {
  let releaseScript!: () => void;
  const scriptGate = new Promise<void>((resolve) => { releaseScript = resolve; });
  let releaseEditor!: () => void;
  const editorGate = new Promise<void>((resolve) => { releaseEditor = resolve; });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await scriptGate;
    await route.continue();
  });
  await page.route(/\/assets\/NoteEditor-[^/]+\.js$/, async (route) => {
    await editorGate;
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'commit' });
  try {
    await expect(page.locator('.nr-boot-shell')).toContainText('正在打开上次文档');
  } finally {
    releaseScript();
  }
  await expect(page.locator('.app')).toBeVisible();
  try {
    await expect(page.locator('.empty-state')).toContainText('正在打开文档');
  } finally {
    releaseEditor();
  }
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('生产 PWA 安装后可以离线冷启动并恢复本地编辑', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright 的离线 Service Worker 网络模拟仅支持 Chromium；Safari 离线冷启动需真机验证。');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const title = page.locator('.note-title');
  await title.fill('PWA 离线恢复验证');
  await title.press('Enter');
  await expect.poll(() => page.evaluate(async () => {
    const id = localStorage.getItem('nr:lastNote');
    if (!id) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nine_rings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const request = db.transaction('notes').objectStore('notes').get(id);
        request.onsuccess = () => resolve(request.result?.title ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  })).toBe('PWA 离线恢复验证');

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.web-status-banner.offline')).toContainText('当前离线');
  await expect(page.locator('.note-title')).toHaveValue('PWA 离线恢复验证');
  await expect(page.locator('.ProseMirror')).toBeEditable();
});
