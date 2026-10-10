import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import {
  replaceSource,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";

for (const sourceMode of [false, true]) {
  test(`内置日期插件插入保存、单步撤销与统计实时更新，源码=${sourceMode}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await expect(
      page.getByRole("button", { name: "内置插件", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    });
    const editor = page.locator(".ProseMirror:visible");
    await editor.evaluate((element) => {
      const ed = (element as HTMLElement & { editor: Editor }).editor;
      ed.commands.insertContent("base");
      ed.commands.setTextSelection(1);
    });
    if (sourceMode) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await selectSource(page.locator(".cm-content"), 0);
    }
    const open = async () => {
      await page.getByRole("button", { name: "内置插件", exact: true }).click();
    };
    await open();
    await page
      .getByRole("menuitem", { name: "插入当前日期", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "日期已插入并保存" }),
    ).toBeVisible();
    const date = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    if (sourceMode) {
      expect((await sourceInfo(page.locator(".cm-content"))).value).toContain(
        date + "base",
      );
      await page.locator(".cm-content").focus();
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      expect((await sourceInfo(page.locator(".cm-content"))).value).toContain(
        "base",
      );
      expect(
        (await sourceInfo(page.locator(".cm-content"))).value,
      ).not.toContain(date);
    } else {
      await expect(editor).toContainText(date + "base");
      await editor.evaluate((element) => {
        (element as HTMLElement & { editor: Editor }).editor.commands.undo();
      });
      await expect(editor).toHaveText("base");
    }
    await page
      .getByRole("button", { name: "关闭插件结果", exact: true })
      .click();
    await open();
    await page
      .getByRole("menuitem", { name: "当前文档统计", exact: true })
      .click();
    const result = page.getByLabel("内置插件结果", { exact: true });
    await expect(result).toContainText("非空白字符 4");
    if (sourceMode)
      await replaceSource(page.locator(".cm-content"), "base more");
    else
      await editor.evaluate((element) => {
        (
          element as HTMLElement & { editor: Editor }
        ).editor.commands.insertContent("more");
      });
    await expect(result).toContainText("非空白字符 8");
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(false);
    });
    await expect(
      page.getByRole("button", { name: "内置插件", exact: true }),
    ).toHaveCount(0);
    await expect(result).toHaveCount(0);
    expect(
      await page.evaluate(async () => {
        const { pluginRuntime } =
          await import("/src/lib/plugin-system/runtime.ts");
        return pluginRuntime.getStatus().activations.length;
      }),
    ).toBe(0);
  });
}

for (const virtual of [false, true]) {
  test(`手机只读统计可用，日期禁用，单独停用释放结果，局部渲染=${virtual}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.evaluate(async (virtual) => {
      localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "nr:experimentalReadonlyRendering",
        }),
      );
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    }, virtual);
    await page.locator(".ProseMirror:visible").evaluate((element) => {
      (
        element as HTMLElement & { editor: Editor }
      ).editor.commands.insertContent("中文😀");
    });
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /^(点击设为可编辑|设为可编辑)$/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "内置插件", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "插入当前日期", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("menuitem", { name: "当前文档统计", exact: true })
      .click();
    await expect(
      page.getByLabel("内置插件结果", { exact: true }),
    ).toContainText("非空白字符 3");
    await page.evaluate(async () => {
      const { pluginLifecycle } =
        await import("/src/lib/plugin-system/lifecycle.ts");
      await pluginLifecycle.deactivate("nine-rings.builtin-statistics");
    });
    await expect(page.getByLabel("内置插件结果", { exact: true })).toHaveCount(
      0,
    );
  });
}
