import { expect, test, type Page } from "@playwright/test";

async function openDocumentView(page: Page) {
  await page.goto("/");
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "tree") await switcher.click();
}

async function createDocument(page: Page, title: string, path: string) {
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByPlaceholder("子路径 (如 nine-rings)").fill(path);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).last()).toBeVisible();
}

async function selectDocuments(page: Page, titles: string[]) {
  await page.getByTitle("批量选择").click();
  for (const title of titles) {
    await page.locator(".doc-tree-doc").filter({ hasText: title }).click();
  }
  await expect(page.locator(".doc-tree-checkbox:checked")).toHaveCount(titles.length);
}

test("文档树支持批量取消只读并移动到新目录", async ({ page }) => {
  await openDocumentView(page);
  const titles = ["批量文档甲", "批量文档乙"];
  await createDocument(page, titles[0], "batch-source");
  await createDocument(page, titles[1], "batch-source");

  await selectDocuments(page, titles);
  await page.getByTitle("批量设为只读").click();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-icon")).toHaveText("🔒");
  }

  await selectDocuments(page, titles);
  await page.getByTitle("批量取消只读").click();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-icon")).not.toHaveText("🔒");
  }

  await selectDocuments(page, titles);
  await page.getByTitle("批量移动").click();
  const dialog = page.getByRole("dialog", { name: "移动到" });
  await expect(dialog.getByText("已选择 2 篇", { exact: true })).toBeVisible();
  await dialog.getByPlaceholder("例如 archives/old").fill("new/batch-target");
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator(".doc-tree-folder .doc-tree-name").filter({ hasText: /^batch-target$/ })).toBeVisible();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title })).toBeVisible();
  }
});

test("文档可从树顶部重命名且标题框修改会立即同步到树", async ({ page }) => {
  await openDocumentView(page);
  await createDocument(page, "重命名前", "rename-entry");

  await page.getByTitle("重命名当前文档").click();
  const renameInput = page.locator(".doc-tree-rename-input");
  await expect(renameInput).toBeFocused();
  await renameInput.fill("树上重命名");
  await renameInput.press("Enter");
  await expect(page.locator(".note-title")).toHaveValue("树上重命名");

  await page.locator(".note-title").fill("标题框同步");
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "标题框同步" })).toBeVisible();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "树上重命名" })).toHaveCount(0);

  await page.waitForTimeout(700);
  await page.reload();
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "tree") await switcher.click();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "标题框同步" })).toBeVisible();
});

test("文档树长名称提供完整文本提示", async ({ page }) => {
  await openDocumentView(page);
  const title = "这是一个用于验证文档树在名称超过侧栏宽度时仍能通过提示查看全部内容的很长文档名称";
  await createDocument(page, title, "tooltip-entry");

  const name = page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-name");
  await expect(name).toHaveAttribute("title", title);
  await expect.poll(() => name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test("目录汇总为同名文档显示相对子路径", async ({ page }) => {
  await openDocumentView(page);
  await createDocument(page, "同名文档.txt", "moc-root/b");
  await createDocument(page, "同名文档.txt", "moc-root/c");

  await page.locator(".doc-tree-folder .doc-tree-name").getByText("moc-root", { exact: true }).click();
  const moc = page.locator(".moc");
  await expect(moc.locator(".moc-title-text", { hasText: "同名文档.txt" })).toHaveCount(2);
  await expect(moc.locator(".moc-title-path", { hasText: /^b$/ })).toBeVisible();
  await expect(moc.locator(".moc-title-path", { hasText: /^c$/ })).toBeVisible();
});
