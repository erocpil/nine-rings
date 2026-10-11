import { expect, test, type Page } from "@playwright/test";

async function openAdvanced(page: Page) {
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.keyboard.press("Alt+,");
  await page
    .getByLabel("设置分类")
    .getByRole("button", { name: /^高级/ })
    .click();
}
for (const width of [390, 1280]) {
  test(`插件列表与配置弹层 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await openAdvanced(page);
    const list = page.getByRole("complementary", {
      name: "插件列表",
      exact: true,
    });
    await expect(list).toHaveCount(0);
    const global = page.getByRole("checkbox", {
      name: "启用插件功能",
      exact: true,
    });
    await global.check();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await expect(list).toContainText("分栏展示");
    await expect(list).toContainText("编辑命令");
    await expect(list).toContainText("文档统计");
    const main = page.locator(".settings-advanced-main");
    const bounds = await list.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width > 768) {
      const left = await main.boundingBox();
      expect(bounds!.x).toBeGreaterThan(left!.x + left!.width);
    }
    const name = list.getByRole("button", { name: "文档树展示", exact: true });
    await name.click();
    const dialog = page.getByRole("dialog", {
      name: "文档树展示配置",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "关闭插件配置", exact: true }),
    ).not.toHaveAttribute("title");
    await expect(
      list.getByRole("checkbox", { name: "启用文档树展示", exact: true }),
    ).not.toBeChecked();
    // All options are available even before enabling the extension.
    await expect(
      dialog.getByRole("spinbutton", { name: "文档树字号", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("spinbutton", { name: "文档树字号", exact: true })
      .fill("18");

    await expect(
      dialog.locator(".plugin-config-heading").getByRole("status"),
    ).toHaveText("已更新");
    expect(
      await dialog
        .getByRole("status")
        .evaluate((element) => element.closest("header") !== null),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "高级", exact: true }),
    ).toBeVisible();
    await expect(name).toBeFocused();
    await list
      .getByRole("checkbox", { name: "启用文档树展示", exact: true })
      .check();
    await name.click();
    await expect(
      dialog.getByRole("spinbutton", { name: "文档树字号", exact: true }),
    ).toHaveValue("18");
    await dialog
      .getByRole("button", { name: "关闭插件配置", exact: true })
      .click();
    for (const plugin of ["插入日期", "实时文档统计"]) {
      await list.getByRole("button", { name: plugin, exact: true }).click();
      const details = page.getByRole("dialog", {
        name: `${plugin}配置`,
        exact: true,
      });
      await expect(
        details.getByRole("combobox", { name: "结果展示", exact: true }),
      ).toBeVisible();
      await details
        .getByRole("combobox", { name: "结果展示", exact: true })
        .selectOption("popup");
      await details
        .getByRole("combobox", { name: "弹层位置", exact: true })
        .selectOption("top");
      await expect(
        details.getByRole("combobox", { name: "弹层位置", exact: true }),
      ).toHaveValue("top");
      await expect(details).toContainText("当前文档");
      await details
        .getByRole("button", { name: "关闭插件配置", exact: true })
        .click();
    }
    await global.uncheck();
    await expect(list).toHaveCount(0);
  });
}

test("另一窗口关闭插件撤销配置弹层，Tab 留在弹层且背景设置不可操作", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await openAdvanced(page);
  await page
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .check();
  await page.getByRole("button", { name: "文档树展示", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "文档树展示配置",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "关闭插件配置", exact: true }),
  ).toBeFocused();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate((element) => {
        const control = document.activeElement!.getBoundingClientRect();
        const panel = element.getBoundingClientRect();
        return control.top >= panel.top && control.bottom <= panel.bottom;
      }),
    ).toBe(true);
  }
  const other = await context.newPage();
  await other.goto("/");
  await openAdvanced(other);
  await other
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .uncheck();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "高级", exact: true }),
  ).toBeVisible();
});

test("列表停用统计立即关闭结果，独立开关跨刷新保留并禁止调用", async ({
  page,
}) => {
  await page.goto("/");
  await openAdvanced(page);
  await page
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .check();
  await page.locator(".settings-close").click();
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "当前文档统计", exact: true })
    .click();
  const result = page.getByLabel("内置插件结果", { exact: true });
  await expect(result).toBeVisible();
  await openAdvanced(page);
  const status = page.getByRole("group", { name: "插件运行状态", exact: true });
  await expect(status).toContainText("nine-rings.builtin-statistics");
  await expect(status.getByRole("button")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "启用实时文档统计", exact: true })
    .uncheck();
  await expect(result).toHaveCount(0);
  await expect(status).toContainText("0 个活动插件");
  await page
    .getByRole("checkbox", { name: "启用插入日期", exact: true })
    .uncheck();
  await page.reload();
  await openAdvanced(page);
  await expect(
    page.getByRole("checkbox", { name: "启用实时文档统计", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "启用插入日期", exact: true }),
  ).not.toBeChecked();
  await page.locator(".settings-close").click();
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "当前文档统计", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "插入日期与时间", exact: true }),
  ).toBeDisabled();
});
