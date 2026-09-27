import { test, expect, type Page } from '@playwright/test';
import { createBlankDocument, waitForSavedText } from './helpers/document';

async function documentDate(page: Page) {
  return page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load('/src/lib/api.ts');
    return (await api.notes.get(localStorage.getItem('nr:lastNote')!)).date;
  });
}

for (const [timezoneId, expected] of [['Asia/Shanghai', '2026-07-28'], ['America/Los_Angeles', '2026-07-27']]) {
  test(`文档创建日期使用本地时区 ${timezoneId}，保存重载后保持`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId });
    try {
      const page = await context.newPage();
      await page.clock.install({ time: new Date('2026-07-27T16:30:00.000Z') });
      await page.goto('/');
      await createBlankDocument(page, '日期验证文档');
      await expect.poll(() => documentDate(page)).toBe(expected);
      await page.locator('.ProseMirror').fill('日期验证正文');
      await waitForSavedText(page, '日期验证正文');
      await page.reload();
      await expect(page.getByPlaceholder('输入文档标题')).toHaveValue('日期验证文档');
      await expect(page.locator('.ProseMirror')).toContainText('日期验证正文');
      await expect.poll(() => documentDate(page)).toBe(expected);
    } finally { await context.close(); }
  });
}
