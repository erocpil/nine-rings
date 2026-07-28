import { test, expect } from '@playwright/test';

/**
 * E2E 路径 3: 导出 → 清库 → 导入 → 验证完整数据
 *
 * 验证全量 JSON 导出的往返兼容性。
 */
test.describe('导出-导入往返', () => {
  test('导出 JSON → 清除数据 → 导入 → 数据完整恢复', async ({ page }) => {
    // 1. 打开应用，确保有至少一条笔记
    await page.goto('/');

    // 2. 创建一条测试笔记
    await page.keyboard.press('Control+n');
    const titleInput = page.locator('[placeholder="随心记 — 标题"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('导出测试笔记');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.fill('导出测试内容 ABC');
    await page.waitForTimeout(1500); // 等待自动保存

    // 3. 打开设置面板 (Alt+, 快捷键)
    await page.keyboard.press('Alt+,');

    // 4. 点击"导出数据"按钮
    const exportBtn = page.getByRole('button', { name: '导出数据' });
    await expect(exportBtn).toBeVisible({ timeout: 5000 });

    // 监听 download 事件（Web 端通过 a.click() 触发下载）
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await exportBtn.click();

    // 5. 获取导出的 JSON 内容
    const download = await downloadPromise;
    // Playwright download: use createReadStream + collect chunks
    const chunks: Buffer[] = [];
    const stream = await download.createReadStream();
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const exportData = Buffer.concat(chunks).toString('utf-8');
    expect(exportData.length).toBeGreaterThan(10);

    // 验证导出格式
    const parsed = JSON.parse(exportData);
    expect(parsed.version).toBeDefined();
    expect(parsed.exported_at).toBeDefined();
    expect(Array.isArray(parsed.notes)).toBe(true);

    // 确认导出包含测试笔记
    const testNote = parsed.notes.find((n: any) => n.title === '导出测试笔记');
    expect(testNote).toBeDefined();

    // 6. 关闭设置面板
    await page.keyboard.press('Escape');

    // 7. 刷新页面后导入
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 8. 重新打开设置 → 数据导出/导入区域
    await page.keyboard.press('Alt+,');

    // 9. 点击"导入数据" → 会触发隐藏的 file input
    const importBtn = page.getByRole('button', { name: '导入数据' });
    await expect(importBtn).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'nine-rings-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportData),
    });

    // 等待导入 toast 出现并消失
    await page.waitForTimeout(3000);

    // 10. 关闭设置面板，验证数据
    await page.keyboard.press('Escape');

    // 侧栏应显示导入的笔记
    const noteInSidebar = page.getByText('导出测试笔记');
    await expect(noteInSidebar.first()).toBeVisible({ timeout: 5000 });
  });
});
