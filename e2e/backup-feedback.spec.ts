import { expect, test } from "@playwright/test";

test("浏览器备份只记录下载发起，不误报文件已保存", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: /数据与导入.*JSON/ }).click();
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
  await page.getByRole("button", { name: /数据与导入.*JSON/ }).click();
  await expect(status).toContainText("浏览器已发起下载");
});
