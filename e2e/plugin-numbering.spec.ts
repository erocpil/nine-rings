import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";

async function enable(page: import("@playwright/test").Page) {
  await page.keyboard.press("Alt+,");
  await page
    .getByLabel("设置分类")
    .getByRole("button", { name: /^高级/ })
    .click();
  await page
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "启用编号展示", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-numbering-blocks",
    "",
  );
  await page.getByRole("button", { name: "编号展示", exact: true }).click();
  return page.getByRole("dialog", { name: "编号展示配置", exact: true });
}
for (const virtual of [false, true])
  test(`编号插件接管块号与行号，保留菜单折叠及停用恢复，局部只读=${virtual}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.locator(".ProseMirror").fill("# 标题\n\n第一段\n\n第二段");
    // Source parsing supplies actual headings for both full and virtual readonly paths.
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.locator(".cm-content").fill("# 标题\n\n第一段\n\n第二段");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    const config = await enable(page);
    await config
      .getByRole("checkbox", { name: "编号粗体", exact: true })
      .check();
    await config
      .getByRole("checkbox", { name: "编号斜体", exact: true })
      .check();
    await config
      .getByRole("spinbutton", { name: "编号字号", exact: true })
      .fill("14");
    await config
      .getByRole("combobox", { name: "编号字体", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    const number = page.locator(".editor-block-number").first();
    await expect(number).toBeVisible();
    await expect(number).toHaveCSS("font-size", "14px");
    await expect(number).toHaveCSS("font-weight", "700");
    await expect(number).toHaveCSS("font-style", "italic");
    await number.click();
    await expect(page.getByRole("menu", { name: /块/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    await expect(
      page.getByRole("checkbox", { name: "显示块编号", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", { name: "相对块号", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", { name: "相对行号", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    if (virtual) {
      await page.evaluate(async () => {
        const { setReadonlyRenderingEnabled } =
          await import("/src/lib/readonly-rendering.ts");
        setReadonlyRenderingEnabled(true);
      });
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
      await expect(page.locator(".vr-note")).toBeVisible();
      await expect(
        page.locator(".vr-note .editor-block-number").first(),
      ).toHaveCSS("font-size", "14px");
      await page
        .getByRole("button", { name: /^(?:点击)?设为可编辑$/, exact: false })
        .click();
    }
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
    await expect(
      page.locator(".plugin-source-fold-symbol:visible").first(),
    ).toHaveText("▾");
    await page
      .locator(".cm-foldGutter .cm-gutterElement")
      .filter({ hasText: "▾" })
      .first()
      .click();
    await expect(
      page.locator(".plugin-source-fold-symbol:visible").first(),
    ).toHaveText("▸");
    const rules = await page.evaluate(() => {
      const title = document
        .querySelector(".markdown-source-title-row")!
        .getBoundingClientRect();
      const tools = document
        .querySelector(".markdown-source-tools")!
        .getBoundingClientRect();
      return {
        left: Math.abs(title.left - tools.left),
        right: Math.abs(title.right - tools.right),
      };
    });
    expect(rules.left).toBeLessThanOrEqual(1);
    expect(rules.right).toBeLessThanOrEqual(1);
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: /^高级/ }).click();
    await page
      .getByRole("checkbox", { name: "启用编号展示", exact: true })
      .uncheck();
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-numbering-blocks",
    );
    await page
      .getByRole("button", { name: "返回设置分类", exact: true })
      .click();
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    await expect(
      page.getByRole("checkbox", { name: "显示块编号", exact: true }),
    ).toBeEnabled();
  });
test("可安装编号数据包无需权限或代码，启用和卸载恢复宿主", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: /^高级/ }).click();
  await page
    .getByRole("checkbox", { name: "启用插件功能", exact: true })
    .check();
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../schema/plugin/examples/acme.numbering/manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  manifest.integrity = { algorithm: "sha256", files: {} };
  const section = page.getByRole("region", {
    name: "已安装声明式插件",
    exact: true,
  });
  await section.getByLabel("选择声明式插件包").setInputFiles({
    name: "numbering.nrplugin.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) }),
    ),
  });
  const review = page.getByRole("dialog", { name: "审查声明式插件包" });
  await expect(review).toContainText("源码行号");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "确认安装", exact: true }).click();
  await section
    .getByRole("checkbox", { name: "启用 示例编号展示", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-numbering-source",
    "",
  );
  await section
    .getByRole("button", { name: "卸载 示例编号展示", exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-numbering-source",
  );
});
