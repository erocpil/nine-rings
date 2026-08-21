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

    // 2. 通过真实 UI 创建一条测试笔记
    await page.getByTitle('随笔').click();
    await page.getByTitle('从模板新建').click();
    await page.getByRole('button', { name: /^📝 空白笔记/ }).click();
    const titleInput = page.locator('[placeholder="随心记 — 标题"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await titleInput.fill('导出测试笔记');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.fill('导出测试内容 ABC');
    await expect(page.locator('.save-status-saved')).toBeVisible({ timeout: 5000 });

    // 3. 打开设置面板 (Alt+, 快捷键)
    await page.keyboard.press('Alt+,');
    await page.getByRole('button', { name: /^数据与导入/ }).click();

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

    // 6. 真正清空 IndexedDB；保持当前页面不刷新，避免首次启动示例数据重新播种
    const remaining = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('nine_rings');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const stores = ['notes', 'daily_pages', 'note_versions']
        .filter((name) => db.objectStoreNames.contains(name));
      const tx = db.transaction(stores, 'readwrite');
      for (const name of stores) tx.objectStore(name).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      const countTx = db.transaction('notes', 'readonly');
      const count = await new Promise<number>((resolve, reject) => {
        const req = countTx.objectStore('notes').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return count;
    });
    expect(remaining).toBe(0);

    // 7. 点击"导入数据" → 会触发隐藏的 file input
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

    await expect(page.getByText(/导入完成：/)).toBeVisible({ timeout: 5000 });

    // 8. 关闭设置面板并刷新，确保验证的是重新写入数据库的数据
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 9. 侧栏应显示导入的笔记
    const noteInSidebar = page.getByText('导出测试笔记');
    await expect(noteInSidebar.first()).toBeVisible({ timeout: 5000 });
  });
});
