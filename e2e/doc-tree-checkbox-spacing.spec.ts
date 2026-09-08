import { expect, test } from "@playwright/test";

test("多选框紧邻文档名称，选择不打开文档", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("button", { name: "批量选择", exact: true }).click();
  const row = sidebar.locator(".doc-tree-doc").first();
  const alignment = await row.evaluate(element => {
    const folder = element.parentElement?.parentElement?.querySelector(":scope > .doc-tree-folder .doc-tree-name");
    const icon = element.querySelector(".doc-tree-icon");
    return folder && icon ? Math.abs(folder.getBoundingClientRect().left - icon.getBoundingClientRect().left) : null;
  });
  expect(alignment).not.toBeNull();
  expect(alignment).toBeLessThanOrEqual(1);
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
