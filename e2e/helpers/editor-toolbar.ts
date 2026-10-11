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
  const direct = toolbar.getByRole("button", { name: labels[0], exact: true });
  await expect(toolbar).toBeVisible();
  // Fonts and the initial ResizeObserver pass can move a tool into overflow
  // after it first becomes visible. Observe consecutive settled frames before
  // selecting the entry, rather than keeping a locator for a transient layout.
  await toolbar.evaluate(async (element) => {
    await document.fonts.ready;
    let previous = "";
    let stable = 0;
    for (let frame = 0; frame < 30 && stable < 3; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const signature = Array.from(element.querySelectorAll("button")).map((button) => {
        const rect = button.getBoundingClientRect();
        return `${button.getAttribute("aria-label")}:${rect.x}:${rect.width}:${rect.height}`;
      }).join("|");
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
    }
  });
  if (await direct.isVisible()) return direct;
  const group = toolbar.getByRole("button", { name: labels[1], exact: true });
  if (labels[1] && await group.isVisible()) {
    await group.click();
    const item = page.getByRole("button", { name: labels[2], exact: true });
    await expect(item).toBeVisible();
    return item;
  }
  const more = toolbar.getByRole("button", { name: "更多编辑操作", exact: true });
  await more.click();
  const item = page.getByRole("button", {
    name: action === "paste" ? "粘贴" : action === "copy" ? "复制" : labels[0], exact: true,
  }).filter({ visible: true });
  // Selection changes can trigger a new width measurement while the menu opens.
  // Wait for whichever real entry the settled layout exposes.
  await expect.poll(async () => {
    if (await item.isVisible()) return true;
    if (await direct.isVisible()) return true;
    return Boolean(labels[1]) && await group.isVisible();
  }).toBe(true);
  if (await item.isVisible()) return item;
  await more.click();
  if (await direct.isVisible()) return direct;
  await group.click();
  const groupedItem = page.getByRole("button", { name: labels[2], exact: true });
  await expect(groupedItem).toBeVisible();
  return groupedItem;
}
