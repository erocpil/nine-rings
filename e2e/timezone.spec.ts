import { test, expect } from '@playwright/test';

/**
 * E2E 路径 2: 不同时区下验证"今日"和跨日行为
 *
 * 通过覆盖浏览器时区模拟不同时区的行为。
 * 验证 localDateKey() 在各种时区下的表现。
 */
test.describe('时区与日期行为', () => {
  test('同一 UTC 时刻在上海跨日、在洛杉矶仍为前一天', async ({ browser }) => {
    const instant = new Date('2026-07-27T16:30:00.000Z');

    const shContext = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
    const shPage = await shContext.newPage();
    await shPage.clock.install({ time: instant });
    await shPage.goto('/');
    await expect(shPage.locator('.daily-date')).toHaveText('7月28日');

    const laContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
    const laPage = await laContext.newPage();
    await laPage.clock.install({ time: instant });
    await laPage.goto('/');
    await expect(laPage.locator('.daily-date')).toHaveText('7月27日');

    await shContext.close();
    await laContext.close();
  });

  test('上海午夜后新建笔记绑定到本地日期', async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-07-27T16:30:00.000Z') });
    await page.goto('/');
    await expect(page.locator('.daily-date')).toHaveText('7月28日');

    await page.getByTitle('随笔').click();
    await page.getByTitle('从模板新建').click();
    await page.getByRole('button', { name: /^📝 空白笔记/ }).click();
    const titleInput = page.locator('[placeholder="随心记 — 标题"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('日期测试笔记');

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.fill('验证日期正确性');
    await expect(page.locator('.save-status-saved')).toBeVisible({ timeout: 5000 });

    await page.reload();
    await expect(page.locator('.daily-date')).toHaveText('7月28日');
    await expect(page.getByText('日期测试笔记').first()).toBeVisible({ timeout: 5000 });
    await context.close();
  });
});
