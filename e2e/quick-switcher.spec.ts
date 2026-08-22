import { test, expect, type Page } from "@playwright/test";

async function createDocument(page: Page, title: string) {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

test("快速切换支持最近访问、检索与完整键盘操作", async ({ page }) => {
  await createDocument(page, "Quick Switch Alpha");
  await createDocument(page, "Quick Switch Beta");

  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "快速切换笔记" });
  const input = page.getByLabel("查找并切换笔记");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(dialog.getByText("Quick Switch Beta", { exact: true })).toBeVisible();

  await input.fill("Alpha");
  await expect(dialog.getByText("Quick Switch Alpha", { exact: true })).toBeVisible();
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("Quick Switch Alpha");

  await page.keyboard.press("Control+p");
  await expect(dialog.getByText("Quick Switch Alpha", { exact: true })).toBeVisible();
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
});
