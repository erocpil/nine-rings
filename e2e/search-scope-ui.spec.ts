import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`查找范围和紧凑控件状态 ${width}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    await page.keyboard.press("Control+Shift+f");
    const global = page.getByRole("textbox", { name: "全局搜索", exact: true });
    await expect(global).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("search-scope.png") });
    await global.fill("范围验证");
    await expect(
      page.locator(".search-input-wrap .search-scope-label"),
    ).toHaveText("全局");
    const clear = page.getByRole("button", { name: "清除搜索", exact: true });
    const target = await clear.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(28);
    expect(target!.height).toBeGreaterThanOrEqual(28);
    await clear.focus();
    await expect(clear).toHaveCSS("outline-style", "solid");
    await clear.click();
    await expect(global).toHaveValue("");
    // Wait past the delayed mobile blur handler and the debounced clear.
    await page.waitForTimeout(250);
    await expect(global).toBeFocused();
    const filters = page.getByRole("button", {
      name: "全局搜索筛选",
      exact: true,
    });
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(filters.locator("svg")).toHaveCount(1);
    await global.press("Escape");

    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Alt+f");
    await expect(
      page.locator(".editor-find-options .search-scope-label"),
    ).toHaveText("当前文档");
    const find = page.getByRole("textbox", {
      name: "在当前文档中查找",
      exact: true,
    });
    await find.fill("不存在的搜索项xyz");
    const previous = page.getByRole("button", {
      name: "上一处匹配",
      exact: true,
    });
    await expect(previous).toBeDisabled();
    await expect(previous).toHaveCSS("opacity", "0.4");
    await find.press("Escape");

    // The desktop entry also exercises the shared mobile drawer's list contents.
    if (width === 1280) {
      await page.getByRole("button", { name: "文档列表", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "文档视图",
        exact: true,
      });
      await dialog
        .getByRole("button", { name: "搜索文档", exact: true })
        .click();
      const list = dialog.getByRole("textbox", {
        name: "查找文档",
        exact: true,
      });
      await expect(list).toBeFocused();
      await list.fill("测试");
      await expect(
        dialog.locator(".document-browser-search .search-scope-label"),
      ).toHaveText("当前列表");
      await expect(list).toHaveAttribute("title", "仅筛选当前列表，不搜索正文");
    }
  });
}
