import { expect, test } from "@playwright/test";

test("多标签页自动刷新并在本地编辑时提示冲突", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);

  const firstEditor = first.locator(".ProseMirror");
  const secondEditor = second.locator(".ProseMirror");
  await expect(firstEditor).toBeEditable({ timeout: 10000 });
  await expect(secondEditor).toBeEditable({ timeout: 10000 });

  const autoRefreshText = `跨标签自动刷新-${Date.now()}`;
  await firstEditor.click();
  await first.keyboard.press("Control+End");
  await first.keyboard.type(autoRefreshText);
  await expect(secondEditor).toContainText(autoRefreshText, { timeout: 5000 });

  const externalText = `外部修改-${Date.now()}`;
  await firstEditor.click();
  await first.keyboard.press("Control+End");
  await first.keyboard.type(externalText);
  await second.waitForTimeout(250);
  await secondEditor.click();
  await second.keyboard.press("Control+End");
  await second.keyboard.type("本页未保存修改");

  await expect(second.locator(".tab-conflict-banner")).toContainText("另一个标签页修改", {
    timeout: 5000,
  });
  await expect(second.getByRole("button", { name: "载入其他标签页版本" })).toBeVisible();
  await expect(second.getByRole("button", { name: "保留本页并覆盖" })).toBeVisible();
});
