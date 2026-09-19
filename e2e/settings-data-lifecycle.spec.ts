import { expect, test } from "@playwright/test";

test("导入跨设置分页及关闭重开继续完成，目标路径保持不变", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^备份与导入/ }).click();
  await page.getByLabel("Markdown 导入目标路径").fill("tests/background-import");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "延迟导入.txt") return original.call(this);
      const file = this;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        Object.assign(window, { releaseSettingsImport: () => {
          File.prototype.arrayBuffer = original;
          original.call(file).then(resolve, reject);
        } });
      });
    };
  });
  await page.locator('input[type="file"][accept^=".md,"]').setInputFiles({
    name: "延迟导入.txt", mimeType: "text/plain", buffer: Buffer.from("首行\n第二行"),
  });
  await expect(page.getByRole("button", { name: /^导入中\.\.\./ })).toBeDisabled();
  for (const label of ["Markdown 导入目标路径", "Markdown 导入文档类型", "Markdown 导入概念标签", "Markdown 导入普通标签"]) {
    await expect(page.getByLabel(label)).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "导出数据", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "导入数据", exact: true })).toBeDisabled();
  await page.getByLabel("返回设置分类").click();
  await page.getByRole("button", { name: /^高级/ }).click();
  await page.getByLabel("关闭设置").click();
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^备份与导入/ }).click();
  await expect(page.getByLabel("Markdown 导入目标路径")).toHaveValue("tests/background-import");
  await page.evaluate(() => (window as Window & { releaseSettingsImport: () => void }).releaseSettingsImport());
  await expect(page.getByText("已导入 1 篇文档", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Markdown 导入普通标签")).toBeEnabled();
  await page.getByLabel("关闭设置").click();
  await expect(page.locator(".doc-tree-doc", { hasText: "延迟导入" })).toBeVisible();
});
