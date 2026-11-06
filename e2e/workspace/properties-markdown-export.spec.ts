import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("属性页导出最新 Markdown，只读文档也可导出", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.locator(".note-title").fill("属性导出验证");
  await editor.fill("刚刚修改的正文");
  await page.getByTitle("显示属性面板", { exact: true }).click();
  const properties = page.locator(".properties-panel");
  for (const readonly of [false, true]) {
    if (readonly) await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    const pending = page.waitForEvent("download");
    await properties.getByRole("button", { name: "导出 Markdown", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("属性导出验证.md");
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("属性导出验证");
    expect(text).toContain("刚刚修改的正文");
  }
});
