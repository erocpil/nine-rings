import { expect, type Page } from "@playwright/test";

/** Use the visible toolbar layout; pane width, not screen width, selects it. */
export async function toolbarAction(page: Page, action: "code" | "paste" | "lineBreak") {
  const label = { code: "代码块 (Ctrl+Alt+C)", paste: "粘贴 (Ctrl+V)", lineBreak: "块内换行" }[action];
  const direct = page.getByRole("button", { name: label, exact: true });
  if (await direct.isVisible()) return direct;
  if (action === "code") {
    await page.getByRole("button", { name: "块", exact: true }).click();
    return page.getByRole("button", { name: "⏹ 代码块", exact: true });
  }
  if (action === "paste" && await page.getByRole("button", { name: "剪贴", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "剪贴", exact: true }).click();
    return page.getByRole("button", { name: "📝 粘贴", exact: true });
  }
  await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
  const item = page.getByRole("button", { name: action === "paste" ? "粘贴" : label, exact: true });
  await expect(item).toBeVisible();
  return item;
}
