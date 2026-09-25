import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const style of ["calm", "calm-compact"] as const) {
  test(`${style} 设置层级与工具栏格式、窄区入口`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createBlankDocument(page);
    await page.evaluate((style) => {
      const c = JSON.parse(localStorage.getItem("nine_rings_config") || "{}");
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          ...c,
          interface_style: style,
          interface_color_mode: "light",
        }),
      );
    }, style);
    await page.reload();
    const editor = page.locator(".note-editor .ProseMirror");
    await editor.fill("工具栏保留熟悉的编辑操作");
    await editor.press("Control+a");
    const bold = page.getByRole("button", {
      name: "加粗 (Ctrl+B)",
      exact: true,
    });
    await bold.click();
    await expect(editor.locator("strong")).toHaveText(
      "工具栏保留熟悉的编辑操作",
    );
    await expect(bold).toHaveClass(/active/);
    await bold.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(bold).toBeFocused();
    await expect(bold).toHaveCSS("outline-style", "solid");
    await page.getByTitle("设置", { exact: true }).click();
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/nr-${style}-settings-root.png`,
    });
    await page.getByRole("button", { name: /^编辑器 / }).click();
    const field = page.getByRole("group", { name: "高亮当前行", exact: true });
    await expect(field).toHaveCSS("border-top-width", "0px");
    await expect(field).toHaveCSS("border-bottom-width", "1px");
    const highlight = page.getByRole("checkbox", {
      name: "高亮当前行",
      exact: true,
    });
    await highlight.uncheck();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("nine_rings_config")!)
              .highlight_active_line,
        ),
      )
      .toBe(false);
    await page
      .getByRole("group", { name: "折叠标识", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("group", { name: "折叠标识", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/nr-${style}-settings-editor.png`,
    });
    await page.getByLabel("返回设置分类").click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page
      .getByRole("group", { name: "风格配色", exact: true })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/nr-${style}-settings-dark.png`,
    });
    await expect
      .poll(() =>
        page
          .locator(".settings-content-page > .settings-field")
          .evaluateAll((fields) =>
            fields.every((el) => el.scrollWidth <= el.clientWidth + 1),
          ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "打开设置查找" }).click();
    await page.getByRole("textbox", { name: "查找设置" }).fill("高亮当前行");
    await page
      .locator(".settings-search-results")
      .getByRole("button")
      .first()
      .click();
    await expect(highlight).not.toBeChecked();
    await page.getByLabel("关闭设置").click();
    await page.setViewportSize({ width: 950, height: 800 });
    await expect(
      page.getByRole("button", { name: "更多编辑操作", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "更多编辑操作", exact: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: "导出 Markdown", exact: true })
        .filter({ visible: true })
        .last(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor.locator("strong")).toHaveText(
      "工具栏保留熟悉的编辑操作",
    );
  });
}
