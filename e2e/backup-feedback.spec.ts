import { expect, test } from "@playwright/test";

test("浏览器备份只记录下载发起，不误报文件已保存", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: /备份与导入.*JSON/ }).click();
  const status = page.getByRole("status", { name: "本机备份导出记录" });
  await expect(status).toContainText("暂无可用");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  await download;
  await expect(status).toContainText("浏览器已发起下载");
  await expect(status).not.toContainText("桌面端已写入");
  await expect(status).toContainText("不等于已备份");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: /备份与导入.*JSON/ }).click();
  await expect(status).toContainText("浏览器已发起下载");
});

test("备份导出期间阻止重复操作，失败后恢复按钮", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^备份与导入/ }).click();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const original = api.export.data;
    api.export.data = () => new Promise((_resolve, reject) => {
      Object.assign(window, { failSettingsExport: () => {
        api.export.data = original;
        reject(new Error("测试导出失败"));
      } });
    });
  });
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在导出…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "导入数据", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "选择目录导入", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Markdown 导入普通标签")).toBeDisabled();
  await page.evaluate(() => (window as Window & { failSettingsExport: () => void }).failSettingsExport());
  await expect(page.getByRole("button", { name: "导出数据", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导入数据", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Markdown 导入普通标签")).toBeEnabled();
  await expect(page.locator(".settings-panel")).toContainText("测试导出失败");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  await download;
});
