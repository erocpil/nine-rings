import { expect, type Page } from "@playwright/test";

type Action = "code" | "copy" | "paste" | "lineBreak" | "exportMarkdown" | "image" | "table";

/** Use the visible toolbar layout; pane width, not screen width, selects it. */
export async function toolbarAction(page: Page, action: Action) {
  const labels = {
    code: ["代码块 (Ctrl+Alt+C)", "块", "⏹ 代码块"],
    copy: ["复制 (Ctrl+C)", "剪贴", "📋 复制"],
    paste: ["粘贴 (Ctrl+V)", "剪贴", "📝 粘贴"],
    lineBreak: ["块内换行", "", "块内换行"],
    exportMarkdown: ["导出 Markdown", "剪贴", "M↑ 导出 Markdown"],
    table: ["插入 3×3 表格", "块", "▦ 插入表格"],
    image: ["插入图片", "", "插入图片"],
  }[action];
  const toolbar = page.locator(".editor-menu");
  const name = labels[0].split(" (")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = toolbar.getByRole("button", { name: new RegExp(`^${name}(?: \\(|$)`) });
  await expect(toolbar).toBeVisible();
  await expect(direct).toBeVisible();
  await direct.scrollIntoViewIfNeeded();
  return direct;
}
