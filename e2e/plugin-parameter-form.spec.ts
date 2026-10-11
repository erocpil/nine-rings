import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import { sourceInfo } from "./helpers/source-editor";

for (const source of [false, true]) {
  test(`多参数图片表单支持四种图片、取消不编辑与单步撤销，源码=${source}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    });
    if (source)
      await page.getByRole("button", { name: "源码", exact: true }).click();
    const editor = page.locator(
      source ? ".cm-content" : ".ProseMirror:visible",
    );
    const open = async () => {
      await editor.click();
      await page.getByRole("button", { name: "内置插件", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "插入图片", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "插入图片参数",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const cancelled = await open();
    await cancelled
      .getByRole("textbox", { name: "替代文本", exact: true })
      .fill("不会插入");
    await page.keyboard.press("Escape");
    await expect(cancelled).toHaveCount(0);
    for (const kind of ["block", "inline", "reference", "linked"]) {
      const before = source
        ? (await sourceInfo(editor)).value
        : await editor.evaluate((element) =>
            JSON.stringify((element as any).editor.getJSON()),
          );
      const dialog = await open();
      await dialog
        .getByRole("combobox", { name: "图片类型", exact: true })
        .selectOption(kind);
      await dialog
        .getByRole("textbox", { name: "替代文本", exact: true })
        .fill(`图片 ${kind}`);
      if (kind === "block") {
        await dialog
          .getByRole("textbox", { name: "图片地址", exact: true })
          .fill("javascript:alert(1)");
        await dialog.getByRole("button", { name: "执行", exact: true }).click();
        await expect(dialog.getByRole("alert")).toContainText("HTTP/HTTPS");
        await dialog
          .getByRole("textbox", { name: "图片地址", exact: true })
          .fill("/icon-192.svg");
      }
      await dialog.getByRole("button", { name: "执行", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByLabel("内置插件结果", { exact: true }),
      ).toContainText("图片已插入并保存");
      await expect(editor).toBeFocused();
      if (source)
        expect((await sourceInfo(editor)).value).toContain(`图片 ${kind}`);
      else
        await expect(editor.locator(`img[alt="图片 ${kind}"]`)).toBeVisible();
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () =>
          source
            ? (await sourceInfo(editor)).value
            : await editor.evaluate((element) =>
                JSON.stringify((element as any).editor.getJSON()),
              ),
        )
        .toBe(before);
      await page.keyboard.press("Escape");
    }
  });
}
