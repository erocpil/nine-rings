import { expect, test, type Page } from "@playwright/test";
import { openDocumentSidebar } from "./helpers/workspace";

async function advanced(page: Page) {
  await page.keyboard.press("Alt+,");
  await page
    .getByLabel("设置分类")
    .getByRole("button", { name: /^高级/ })
    .click();
}
for (const width of [390, 1280]) {
  test.describe(`${width}px panel presentation`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: width === 390 });
    test("展示配置、工具命令及停用回退保持树状态", async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("nr:pluginsEnabled", "true");
        localStorage.setItem(
          "nr:pluginTreeDisplay",
          JSON.stringify({
            enabled: true,
            display: {
              target: "document-tree",
              font: "mono",
              fontSize: 17,
              rowHeight: 28,
              labelColor: "secondary",
              tooltip: "path",
              showCounts: false,
              showMetadata: false,
              toolbar: ["tree.expand-all", "tree.refresh"],
            },
          }),
        );
      });
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await openDocumentSidebar(page);
      const tree = page.locator(".app-sidebar .doc-tree");
      await expect(tree).toHaveAttribute("data-panel-display", "plugin");
      await expect(tree.locator(".doc-tree-count")).toHaveCount(0);
      await expect(tree.locator(".doc-tree-type")).toHaveCount(0);
      const expand = page.getByRole("button", {
        name: "展开所有目录",
        exact: true,
      });
      await expand.click();
      const folder = tree.locator(".doc-tree-folder .doc-tree-name").first();
      await expect(folder).toHaveCSS("font-size", "17px");
      const row = tree.locator(".doc-tree-node").first();
      expect(
        await row.evaluate((element) => element.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(width === 390 ? 36 : 28);
      const doc = tree.locator(".doc-tree-open").first();
      await expect(doc).toHaveAttribute("title", /\//);
      await page
        .getByRole("button", { name: "刷新文档树", exact: true })
        .click();
      await expect(doc).toBeVisible();
      const toggle = tree.locator("button[aria-expanded]").first();
      await toggle.click();
      const folds = await page.evaluate(() =>
        localStorage.getItem("nr:docTreeCollapsed"),
      );
      await page.evaluate(async () => {
        const { setPluginsEnabled } =
          await import("/src/lib/plugin-system/runtime.ts");
        setPluginsEnabled(false);
      });
      await expect(tree).not.toHaveAttribute("data-panel-display", "plugin");
      await expect(expand).toHaveCount(0);
      expect(
        await page.evaluate(() => localStorage.getItem("nr:docTreeCollapsed")),
      ).toBe(folds);
      await page.evaluate(async () => {
        const { setPluginsEnabled } =
          await import("/src/lib/plugin-system/runtime.ts");
        setPluginsEnabled(true);
      });
      await expect(tree).toHaveAttribute("data-panel-display", "plugin");
      expect(
        await page.evaluate(() => localStorage.getItem("nr:docTreeCollapsed")),
      ).toBe(folds);
      await page.reload();
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await openDocumentSidebar(page);
      await expect(tree).toHaveAttribute("data-panel-display", "plugin");
    });
  });
}

test("设置入口、浅深主题、独立停用及恢复默认", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await advanced(page);
  const enabled = page.getByRole("checkbox", {
    name: "内置文档树展示插件",
    exact: true,
  });
  await expect(enabled).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .check();
  await enabled.check();
  await page
    .getByRole("spinbutton", { name: "文档树字号", exact: true })
    .fill("18");
  await page
    .getByRole("combobox", { name: "文档名称颜色", exact: true })
    .selectOption("accent");
  await expect(
    page.locator('.doc-tree[data-panel-display="plugin"]').first(),
  ).toHaveCSS("--panel-display-font-size", "18px");
  await page
    .getByRole("button", { name: "恢复文档树展示默认设置", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "文档树字号", exact: true }),
  ).toHaveValue("14");
  const stop = page.getByRole("button", {
    name: "停用 nine-rings.builtin-tree-display",
    exact: true,
  });
  await stop.click();
  await expect(
    page.locator('.doc-tree[data-panel-display="plugin"]'),
  ).toHaveCount(0);
  await expect(stop).toHaveCount(0);
  await enabled.uncheck();
  await enabled.check();
  await expect(stop).toBeVisible();
  await page.locator(".settings-close").click();
  await openDocumentSidebar(page);
  const resolved: string[] = [];
  for (const theme of ["light", "dark"]) {
    await page.locator(".app").evaluate((element, value) => {
      element.classList.remove("theme-light", "theme-dark");
      element.classList.add(`theme-${value}`);
    }, theme);
    const name = page
      .locator(".app-sidebar .doc-tree-doc .doc-tree-name")
      .first();
    const colors = await name.evaluate((element) => {
      const row = element.closest(".doc-tree-node")!;
      const probe = document.createElement("span");
      probe.style.color = row.classList.contains("doc-tree-selected")
        ? "var(--accent)"
        : "var(--text)";
      row.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).color, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    resolved.push(colors.actual);
  }
  expect(resolved[0]).not.toBe(resolved[1]);
});
