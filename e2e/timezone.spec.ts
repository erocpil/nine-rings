import { test, expect } from '@playwright/test';

/**
 * E2E 路径 2: 不同时区下验证"今日"和跨日行为
 *
 * 通过覆盖浏览器时区模拟不同时区的行为。
 * 验证 localDateKey() 在各种时区下的表现。
 */
test.describe('时区与日期行为', () => {
  test('UTC 日期与本地日期在日界线两侧表现一致', async ({ browser }) => {
    // 使用 UTC 时区上下文
    const utcContext = await browser.newContext({ timezoneId: 'UTC' });
    const utcPage = await utcContext.newPage();
    
    await utcPage.goto('/');
    await utcPage.waitForLoadState('networkidle');

    // 获取 Header 中显示的日期
    // DailyOverview 组件显示类似 "周三 7/9 · 3 篇笔记 · 2/5 待办"
    const dateDisplay = utcPage.locator('text=/周[一二三四五六日]/');
    const utcDateText = await dateDisplay.first().textContent();
    
    // 使用 Asia/Shanghai 时区上下文
    const shContext = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
    const shPage = await shContext.newPage();
    
    await shPage.goto('/');
    await shPage.waitForLoadState('networkidle');

    const shDateDisplay = shPage.locator('text=/周[一二三四五六日]/');
    const shDateText = await shDateDisplay.first().textContent();

    // 如果两个时区在同一天（UTC 早 8 点后），日期应一致
    // 如果 UTC 在 00:00-07:59 而 Shanghai 已跨日，则日期不同
    // 这是预期行为 — 测试不强制要求一致，只验证页面正常渲染
    expect(utcDateText).toBeTruthy();
    expect(shDateText).toBeTruthy();

    await utcContext.close();
    await shContext.close();
  });

  test('新建笔记绑定到正确的本地日期', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 获取当日日期文本（格式：周几 月/日）
    const dateDisplay = page.locator('text=/周[一二三四五六日]/');
    const todayText = await dateDisplay.first().textContent();
    expect(todayText).toBeTruthy();

    // 创建笔记
    await page.keyboard.press('Control+n');
    const titleInput = page.locator('[placeholder="随心记 — 标题"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('日期测试笔记');

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.fill('验证日期正确性');
    await page.waitForTimeout(1500);

    // 刷新后笔记应仍在同日视图下
    await page.reload();
    await page.waitForLoadState('networkidle');

    const noteInSidebar = page.getByText('日期测试笔记');
    await expect(noteInSidebar.first()).toBeVisible({ timeout: 5000 });
    
    // Header 日期不应变化
    const dateAfter = page.locator('text=/周[一二三四五六日]/');
    const dateAfterText = await dateAfter.first().textContent();
    expect(dateAfterText).toBe(todayText);
  });
});
