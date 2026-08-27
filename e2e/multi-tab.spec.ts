import { expect, test } from "@playwright/test";

test("多标签页自动刷新并在本地编辑时提示冲突", async ({ context }) => {
  test.slow();
  const first = await context.newPage();
  const firstEditor = first.locator(".ProseMirror");
  await first.goto("/");
  await expect(firstEditor).toBeEditable({ timeout: 30000 });

  // 两个完整应用实例并发冷启动会让该用例受 worker 负载影响；先确认首个
  // 标签可编辑，再启动第二个标签，不改变后续跨标签同步覆盖范围。
  const second = await context.newPage();
  const secondEditor = second.locator(".ProseMirror");
  await second.goto("/");
  await expect(secondEditor).toBeEditable({ timeout: 30000 });
  // 编辑器先于跨标签 BroadcastChannel effect 挂载；等待一个短窗口，避免
  // 首次保存发生在第二个标签注册监听器之前。
  await second.waitForTimeout(500);

  const autoRefreshText = `跨标签自动刷新-${Date.now()}`;
  await firstEditor.click();
  await first.keyboard.press("Control+End");
  await first.keyboard.type(autoRefreshText);
  await expect(firstEditor).toContainText(autoRefreshText);
  await expect(first.locator(".save-status-dirty")).toBeVisible();
  await expect(first.locator(".save-status-saved")).toBeVisible({ timeout: 30000 });
  await expect(secondEditor).toContainText(autoRefreshText, { timeout: 30000 });

  const externalText = `外部修改-${Date.now()}`;
  await firstEditor.click();
  await first.keyboard.press("Control+End");
  await first.keyboard.type(externalText);
  await expect(firstEditor).toContainText(externalText);
  await expect(first.locator(".save-status-dirty")).toBeVisible();

  await secondEditor.click();
  await second.keyboard.press("Control+End");
  await second.keyboard.type("本页未保存修改");
  await expect(second.locator(".save-status-dirty")).toBeVisible();
  await expect(first.locator(".save-status-saved")).toBeVisible({ timeout: 30000 });

  await expect(second.locator(".tab-conflict-banner")).toContainText("另一个标签页修改", {
    timeout: 30000,
  });
  await expect(second.getByRole("button", { name: "载入其他标签页版本" })).toBeVisible();
  await expect(second.getByRole("button", { name: "保留本页并覆盖" })).toBeVisible();
});
