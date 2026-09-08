import { expect, test } from "@playwright/test";

test("密码文档可编辑、重新锁定且全局搜索不泄露解锁正文", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.locator(".note-title").fill("公开的加密测试标题");
  await editor.fill("cipher-e2e-secret 这是需要保护的正文");
  await page.getByRole("button", { name: "设置文档密码", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置文档密码", exact: true });
  await dialog.getByLabel("密码", { exact: true }).fill("password-123456");
  await dialog.getByLabel("确认密码", { exact: true }).fill("password-123456");
  await dialog.getByRole("button", { name: "设置密码", exact: true }).click();
  await expect(page.getByRole("region", { name: "加密文档", exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "输入密码打开" }).click();
  const unlock = page.getByRole("dialog", { name: "打开加密文档" });
  await unlock.getByLabel("密码", { exact: true }).fill("incorrect");
  await unlock.getByRole("button", { name: "验证密码" }).click();
  await expect(unlock.getByRole("alert")).toContainText("密码错误");
  await unlock.getByLabel("密码", { exact: true }).fill("password-123456");
  await unlock.getByRole("button", { name: "验证密码" }).click();
  await expect(editor).toContainText("cipher-e2e-secret");
  await editor.fill("cipher-edited-secret 保存后也应为密文");
  await page.getByRole("button", { name: "锁定文档", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "输入密码打开" }).click();
  await unlock.getByLabel("密码", { exact: true }).fill("password-123456");
  await unlock.getByRole("button", { name: "验证密码" }).click();
  await expect(editor).toContainText("cipher-edited-secret");
  const stored = await page.evaluate(async () => {
    return new Promise<string>((resolve, reject) => {
      const open = indexedDB.open("nine_rings");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(["notes", "note_versions"]);
        const notes = tx.objectStore("notes").getAll(); const versions = tx.objectStore("note_versions").getAll();
        tx.oncomplete = () => { db.close(); resolve(JSON.stringify([notes.result, versions.result])); };
      };
    });
  });
  expect(stored).not.toContain("cipher-edited-secret");
  expect(stored).not.toContain("cipher-e2e-secret");
  expect(stored).toContain('"encrypted"');
  await page.keyboard.press("Control+p");
  const switcher = page.getByRole("dialog", { name: "快速切换笔记" });
  await switcher.getByRole("combobox").fill("cipher-edited-secret");
  await expect(switcher).not.toContainText("公开的加密测试标题");
  await switcher.getByRole("combobox").fill("公开的加密测试标题");
  await expect(switcher).toContainText("公开的加密测试标题");
  await expect(switcher).not.toContainText("保存后也应为密文");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("region", { name: "加密文档", exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
});
