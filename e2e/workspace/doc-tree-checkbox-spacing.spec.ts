import { expect, test } from "@playwright/test";

test("多选框紧邻文档名称，选择不打开文档", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("button", { name: "批量选择", exact: true }).click();
  const row = sidebar.locator(".doc-tree-doc").first();
  // Path checkboxes have their own column after the folder chevron. Document
  // checkboxes follow the document icon and remain adjacent to the name.
  const checkbox = row.getByRole("checkbox");
  await expect(checkbox).toBeVisible();
  const box = (await checkbox.boundingBox())!;
  const title = (await row.locator(".doc-tree-name").boundingBox())!;
  expect(title.x - box.x - box.width).toBeGreaterThanOrEqual(0);
  expect(title.x - box.x - box.width).toBeLessThanOrEqual(5);
  const currentTitle = await page.locator(".note-title").inputValue();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(page.locator(".note-title")).toHaveValue(currentTitle);
});
