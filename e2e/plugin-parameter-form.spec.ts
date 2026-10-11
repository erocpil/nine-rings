import { expect, test } from "./helpers/reader-test";
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

for (const source of [false, true]) {
  test(`选择本机图片：取消不存储、插入可撤销、刷新和备份保留图片，源码=${source}`, async ({ page }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.evaluate(async () => {
      const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    });
    if (source) await page.getByRole("button", { name: "源码", exact: true }).click();
    const editor = page.locator(source ? ".cm-content" : ".ProseMirror:visible");
    const open = async () => {
      await editor.click();
      await page.getByRole("button", { name: "内置插件", exact: true }).click();
      await page.getByRole("menuitem", { name: "插入图片", exact: true }).click();
      return page.getByRole("dialog", { name: "插入图片参数", exact: true });
    };
    const count = () => page.evaluate(async () => {
      const { withDB, getAll } = await import("/src/lib/storage/db.ts");
      return withDB(async db => (await getAll(db.transaction("images").objectStore("images"))).length);
    });
    const beforeCount = await count();
    let dialog = await open();
    await dialog.getByLabel("选择图片文件", { exact: true }).setInputFiles("public/icon-192.png");
    await page.keyboard.press("Escape");
    expect(await count()).toBe(beforeCount);
    dialog = await open();
    await dialog.getByLabel("选择图片文件", { exact: true }).setInputFiles("public/icon-192.png");
    await dialog.getByRole("textbox", { name: "替代文本", exact: true }).fill("本机图片验证");
    await dialog.getByRole("button", { name: "执行", exact: true }).click();
    await expect(page.getByLabel("内置插件结果", { exact: true })).toContainText("图片已插入并保存");
    await expect(editor).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => editor.textContent()).not.toContain("本机图片验证");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(count).toBe(beforeCount + 1);
    await expect.poll(() => page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
      return JSON.stringify(note?.content);
    })).toContain("nr-image://");
    const backup = await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const { resolveImageRefs } = await import("/src/lib/storage/db-images.ts");
      return JSON.stringify(await resolveImageRefs(await api.notes.get(localStorage.getItem("nr:lastNote")!)));
    });
    expect(backup).toContain("data:image/png;base64,");
    expect(backup).not.toContain("nr-image://");
    await page.reload();
    await expect(editor).toBeVisible();
    if (await page.locator(".cm-content").count()) await page.getByRole("button", { name: "渲染", exact: true }).click();
    const image = page.locator('img[alt="本机图片验证"]');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });
}
