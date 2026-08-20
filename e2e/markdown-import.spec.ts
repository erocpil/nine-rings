import { expect, test } from "@playwright/test";

test("Markdown 可按指定路径和元数据导入为文档", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();

  await page.getByLabel("Markdown 导入目标路径").fill("references/import-e2e");
  await page.getByLabel("Markdown 导入文档类型").selectOption("tutorial");
  await page.getByLabel("Markdown 导入概念标签").fill("DPDK, 网络");
  await page.getByLabel("Markdown 导入普通标签").fill("imported");

  const input = page.locator('input[type="file"][accept=".md"]');
  await input.setInputFiles({
    name: "review-import.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Imported Review\r\n\r\n- **VFIO/UIO接入层**\r\n  - 子项", "utf8"),
  });

  await expect(page.getByText("已导入 1 篇笔记")).toBeVisible();
  await page.locator(".settings-close").click();
  const viewSwitch = page.locator(".sidebar-view-switch");
  if (await viewSwitch.getAttribute("data-target-view") === "tree") await viewSwitch.click();

  await expect(page.locator(".doc-tree-name", { hasText: "references" })).toBeVisible();
  await expect(page.locator(".doc-tree-name", { hasText: "import-e2e" })).toBeVisible();
  const imported = page.locator(".doc-tree-doc", { hasText: "Imported Review" });
  await expect(imported).toBeVisible();
  await imported.click();

  await expect(page.locator(".note-title")).toHaveValue("Imported Review");
  await expect(page.locator(".tag-chip", { hasText: "imported" })).toBeVisible();
  await expect(page.locator(".ProseMirror > ul > li > ul > li")).toHaveText("子项");
});
