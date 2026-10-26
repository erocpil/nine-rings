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
  test(`当前块底色覆盖完整块高及折叠栏，随布局和折叠更新，局部只读=${virtual}`, async ({ page }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.locator(".cm-content").fill([
      `# ${"高标题需要完整覆盖编号与折叠区域 ".repeat(6)}`,
      "多行正文也需要完整覆盖。".repeat(12),
      "```c\nint main(void) {\n    int count = 1;\n    return count;\n}\n```",
    ].join("\n\n"));
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await enable(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();

    const checkBand = async (index: number) => {
      const band = page.locator(`.editor-block-current-band[data-block-index="${index}"]`);
      await expect(band).toBeVisible();
      await expect(band).toHaveCSS("pointer-events", "none");
      await expect(band).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect.poll(() => band.evaluate((element, blockIndex) => {
        const body = element.closest(".vr-row")?.querySelector(".vr-block")
          ?? element.closest(".editor-content-shell")?.querySelector(`.ProseMirror > :nth-child(${blockIndex})`);
        if (!body) return Infinity;
        const block = body.getBoundingClientRect(), stripe = element.getBoundingClientRect();
        return Math.max(Math.abs(block.top - stripe.top), Math.abs(block.bottom - stripe.bottom));
      }, index)).toBeLessThan(1);
      const number = page.locator(`.editor-block-number[data-block-index="${index}"]`);
      const stripeBox = (await band.boundingBox())!, numberBox = (await number.boundingBox())!;
      expect(stripeBox.x).toBeLessThan(numberBox.x);
      expect(stripeBox.height).toBeGreaterThan(numberBox.height);
    };
    const heading = page.locator(".ProseMirror h1");
    await heading.click();
    await checkBand(1);
    const initialHeight = (await heading.boundingBox())!.height;
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(async () => (await heading.boundingBox())!.height).toBeGreaterThan(initialHeight);
    await checkBand(1);

    await page.evaluate(async enabled => {
      const { setReadonlyRenderingEnabled } = await import("/src/lib/readonly-rendering.ts");
      setReadonlyRenderingEnabled(enabled);
    }, virtual);
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    await expect(page.locator(virtual ? ".vr-note" : ".editor-content-shell")).toBeVisible();
    await heading.click();
    await checkBand(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkBand(1);
    await page.setViewportSize({ width: 900, height: 800 });
    await checkBand(1);
    const fold = page.getByRole("button", { name: virtual ? /^折叠切换 高标题/ : /^(折叠|展开)第 1 块章节$/ }).first();
    await fold.click();
    await checkBand(1);
    await fold.click();
    const paragraph = page.locator(virtual ? '.vr-row[data-block-number="2"] .vr-block > p' : ".ProseMirror > p");
    await paragraph.click();
    await checkBand(2);
    await expect(page.locator('.editor-block-current-band[data-block-index="1"]')).toHaveCount(0);
    await page.locator(virtual ? '.vr-row[data-block-number="3"] pre' : ".ProseMirror pre").click();
    await checkBand(3);
  });

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
    await config.getByRole("combobox", { name: "编号配置目标", exact: true }).selectOption("source");
    await config.getByRole("combobox", { name: "编号展示折叠连接线样式", exact: true }).selectOption("dotted");
    await config.getByRole("combobox", { name: "编号展示折叠连接线宽度", exact: true }).selectOption("4");
    await config.getByRole("combobox", { name: "编号展示折叠连接线透明度", exact: true }).selectOption("75");
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
    await page.locator('.cm-foldGutter [data-fold-kind="expanded"]').first().hover();
    await page.locator('.cm-foldGutter [data-fold-kind="expanded"]').first().dispatchEvent("mouseover");
    const connector = page.locator(".source-fold-connector");
    await expect(connector).toHaveAttribute("data-connector-style", "dotted");
    await expect(connector).toHaveCSS("width", "4px");
    await expect(connector).toHaveCSS("opacity", "0.75");
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
        left: Math.abs(title.left + 12 - tools.left),
        right: Math.abs(title.right - 12 - tools.right),
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
  await review.getByRole("button", { name: /点击确认：我已检查来源/ }).click();
  await review.getByRole("button", { name: "确认安装", exact: true }).click();
  await section
    .getByRole("checkbox", { name: "切换 示例编号展示", exact: true })
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

test("编号配置宽屏分组双栏、窄屏单栏，鼠标打开关闭不突出焦点按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createBlankDocument(page);
  const dialog = await enable(page);
  await expect(dialog).toBeFocused();
  const groups = dialog.locator('.numbering-settings-group');
  const first = await groups.nth(0).boundingBox();
  const second = await groups.nth(1).boundingBox();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  expect(second!.x).toBeGreaterThan(first!.x + first!.width);
  await page.setViewportSize({ width: 600, height: 900 });
  const narrowFirst = await groups.nth(0).boundingBox();
  const narrowSecond = await groups.nth(1).boundingBox();
  expect(narrowSecond!.y).toBeGreaterThan(narrowFirst!.y + narrowFirst!.height);
  await page.keyboard.press('Escape');
  const trigger = page.getByRole('button', { name: '编号展示', exact: true });
  await expect(page.getByRole('dialog', { name: '编号展示配置', exact: true })).toHaveCount(0);
  await expect(trigger).toHaveCSS('outline-style', 'none');
  // Tab must restore keyboard focus styling even after pointer-driven dismissal.
  await page.keyboard.press('Tab');
  await expect(trigger).not.toHaveAttribute('data-pointer-focus', 'true');
  // WebKit Tab traversal depends on the OS full-keyboard-access preference.
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '编号展示配置', exact: true })).toBeVisible();
});
