import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("源码状态栏管理行号与折叠，保存偏好且尊重插件接管", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
  await createBlankDocument(page, "源码行号设置");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const source = "# A\n\none\n\n## B\n\ntwo\n\n# C\n\nthree";
  await replaceSource(area, source);
  const trigger = page.getByRole("button", { name: "行号与折叠设置", exact: true });
  const menu = page.getByRole("menu", { name: "行号与折叠设置", exact: true });
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(1);
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: /折叠全部|展开全部|按标题级别/ })).toHaveCount(0);
  await menu.getByRole("menuitemcheckbox", { name: "显示行号", exact: true }).click();
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await menu.getByRole("menuitemcheckbox", { name: "相对行号", exact: true }).click();
  await expect(page.locator(".cm-relative-current")).toHaveCount(1);
  await expect(menu.getByRole("menuitemcheckbox", { name: "显示行号", exact: true })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitem", { name: /^当前行号对齐/ }).click();
  await menu.getByRole("menuitemcheckbox", { name: "右对齐", exact: true }).click();
  await expect(page.locator(".cm-relative-current-right")).toHaveCount(1);
  await page.getByRole("button", { name: "折叠全部", exact: true }).click();
  await expect(page.locator(".cm-foldPlaceholder").first()).toBeVisible();
  const folded = await page.locator(".cm-foldPlaceholder").count();
  await trigger.click();
  await menu.getByRole("menuitemcheckbox", { name: "显示折叠图标", exact: true }).click();
  await expect(page.locator(".cm-foldGutter")).toHaveCount(0);
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(folded);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect(page.locator(".cm-foldPlaceholder")).toHaveCount(0);
  expect((await sourceInfo(area)).value).toBe(source);
  await waitForSavedText(page, "three");
  await page.reload();
  await expect(area).toBeVisible();
  await expect(page.locator(".cm-relative-current-right")).toHaveCount(1);
  await expect(page.locator(".cm-foldGutter")).toHaveCount(0);
  await trigger.click();
  await menu.getByRole("menuitemcheckbox", { name: "显示折叠图标", exact: true }).click();
  await expect(page.locator(".cm-foldGutter")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { pluginRuntime } = await load("/src/lib/plugin-system/runtime.ts");
    const { numberingDisplays } = await load("/src/lib/plugin-system/numbering-display.ts");
    const { DEFAULT_NUMBERING_DISPLAYS } = await load("/src/lib/plugin-system/builtin-numbering-display.ts");
    pluginRuntime.setEnabled(true);
    numberingDisplays.register(pluginRuntime.activate("test.source-gutter", []), [
      { ...DEFAULT_NUMBERING_DISPLAYS.find((item: { target: string }) => item.target === "source"), visible: false },
    ]);
  });
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await trigger.click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "显示行号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitemcheckbox", { name: "相对行号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitemcheckbox", { name: "显示折叠图标", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const path = "/src/lib/plugin-system/runtime.ts";
    const { pluginRuntime } = await import(/* @vite-ignore */ path);
    pluginRuntime.deactivate("test.source-gutter");
  });
  await expect(page.locator(".cm-relative-current-right")).toHaveCount(1);
  expect((await sourceInfo(area)).value).toBe(source);
});
