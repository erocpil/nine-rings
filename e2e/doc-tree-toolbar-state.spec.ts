import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openDocumentSidebar } from "./helpers/workspace";

test("文档树工具栏只对当前打开的文档或路径启用操作，首页驻留文档不算选择", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({
    interface_style: "calm", workspace_layout: "exhibition",
  })));
  await createBlankDocument(page, "工具栏当前选择");
  const properties = page.getByTitle(/^(显示|隐藏)属性面板$/);
  const keep = page.getByTitle("折叠其它目录（保留当前文档所在目录）", { exact: true });
  const rename = page.getByTitle("重命名当前文档", { exact: true });
  const exportPath = page.getByTitle("导出路径下的文档（Markdown ZIP）", { exact: true });
  const deletePath = page.getByTitle("删除选中目录", { exact: true });
  await expect(properties).toBeEnabled();
  await expect(keep).toBeEnabled();
  await expect(rename).toBeEnabled();
  await expect(page.getByTitle("复制所在路径", { exact: true })).toBeEnabled();
  await expect(exportPath).toBeDisabled();
  await expect(deletePath).toBeDisabled();

  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
  await page.mouse.move(10, 200);
  await openDocumentSidebar(page);
  await expect(properties).toBeDisabled();
  await expect(keep).toBeDisabled();
  await expect(rename).toBeDisabled();
  await expect(page.getByTitle("复制路径", { exact: true })).toBeDisabled();
  await expect(exportPath).toBeDisabled();
  await expect(deletePath).toBeDisabled();
  await expect(page.getByTitle("新建文档", { exact: true })).toBeEnabled();
  await expect(page.getByTitle("批量选择", { exact: true })).toBeEnabled();

  await page.locator(".doc-tree-folder .doc-tree-name").filter({ hasText: /^references$/ }).click();
  await expect(properties).toBeEnabled();
  await expect(keep).toBeEnabled();
  await expect(page.getByTitle("复制路径", { exact: true })).toBeEnabled();
  await expect(exportPath).toBeEnabled();
  await expect(deletePath).toBeEnabled();
  await expect(rename).toBeDisabled();
  if (await properties.getAttribute("aria-pressed") === "false") await properties.click();
  await expect(page.locator(".properties-panel")).toBeVisible();
});
