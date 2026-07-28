import { test, expect } from '@playwright/test';

/**
 * E2E 路径 1: 创建笔记 → 编辑 → 自动保存 → 刷新 → 验证内容
 *
 * 前置条件：IndexedDB 初始为空（新打开的应用）
 */
test.describe('创建-编辑-保存-刷新', () => {
  test('新建笔记、编辑标题内容、刷新后数据保持', async ({ page }) => {
    // 1. 打开应用
    await page.goto('/');

    // 2. 通过真实 UI 新建空白笔记（避免误编辑首次启动的示例笔记）
    await page.getByTitle('随笔').click();
    await page.getByTitle('从模板新建').click();
    await page.getByRole('button', { name: /^📝 空白笔记/ }).click();

    const titleInput = page.locator('[placeholder="随心记 — 标题"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('新随笔');

    // 3. 填入标题
    await titleInput.fill('E2E 测试笔记');
    
    // 4. 编辑内容 — TipTap 编辑器在 contenteditable 的 div 中
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.fill('这是 E2E 测试的正文内容。包含中文和标点。');

    // 5. 等待可观察的保存完成状态，而不是固定 sleep
    await expect(page.locator('.save-status-saved')).toBeVisible({ timeout: 5000 });

    // 6. 刷新页面
    await page.reload();
    await page.waitForLoadState('networkidle');

    // 7. 验证笔记仍存在
    // Sidebar 中应显示笔记标题
    const noteInSidebar = page.getByText('E2E 测试笔记');
    await expect(noteInSidebar.first()).toBeVisible({ timeout: 5000 });

    // 8. 点击进入笔记，验证内容
    await noteInSidebar.first().click();
    await expect(titleInput).toHaveValue('E2E 测试笔记');
    
    // 验证编辑器内容
    const editorAfter = page.locator('.ProseMirror');
    await expect(editorAfter).toContainText('这是 E2E 测试的正文内容');
  });
});
