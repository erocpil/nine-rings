import { expect, test } from "@playwright/test";

test("JSON 导入失败后可以再次选择同一文件", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  const input = page.locator('.settings-panel input[type="file"][accept=".json"]');
  await input.evaluate(element => {
    element.addEventListener("change", () => {
      element.setAttribute("data-changes", String(Number(element.getAttribute("data-changes") ?? 0) + 1));
    });
  });
  const invalid = { name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{invalid") };
  for (const count of [1, 2]) {
    await input.setInputFiles(invalid);
    await expect(page.locator(".settings-panel")).toContainText("导入失败");
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("data-changes", String(count));
    await expect(page.getByRole("button", { name: "导入数据", exact: true })).toBeEnabled();
  }
});
