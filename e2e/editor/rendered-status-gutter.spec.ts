import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "../helpers/document";
import { closeDocumentSidebar } from "../helpers/workspace";

for (const virtual of [false, true]) for (const style of ["classic", "calm"]) test(`渲染状态栏管理块号与折叠且不修改正文 style=${style} virtual=${virtual}`, async ({ page }) => {
  await page.addInitScript(({ virtual, style }) => {
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true, interface_style: style }));
  }, { virtual, style });
  await createBlankDocument(page, "渲染块号设置");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section" }] },
      { type: "paragraph", content: [{ type: "text", text: "First paragraph" }] },
      { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
      { type: "codeBlock", attrs: { language: "c" }, content: [{ type: "text", text: "int a;\nint b;" }] },
    ] }, true);
  });
  await waitForSavedText(page, "Second paragraph");
  if (virtual) await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const savedContent = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return JSON.stringify((await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content);
  });
  const before = await savedContent();
  const trigger = page.getByRole("button", { name: "块号与折叠设置", exact: true });
  const menu = page.getByRole("menu", { name: "块号与折叠设置", exact: true });
  await trigger.click();
  await expect(menu.getByRole("menuitem", { name: /不可见字符|Tab Size|缩进方式|显示行号/ })).toHaveCount(0);
  const visible = menu.getByRole("menuitemcheckbox", { name: "显示块号", exact: true });
  await visible.click();
  await expect(menu).toBeVisible();
  await expect(page.locator(".note-editor:visible")).not.toHaveClass(/show-line-numbers/);
  await expect(menu.getByRole("menuitemcheckbox", { name: "相对块号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: /^当前块号对齐/ })).toBeDisabled();
  await visible.click();
  await expect(page.locator(".note-editor:visible")).toHaveClass(/show-line-numbers/);
  await menu.getByRole("menuitemcheckbox", { name: "相对块号", exact: true }).click();
  await menu.getByRole("menuitem", { name: /^当前块号对齐/ }).click();
  await menu.getByRole("menuitemcheckbox", { name: "左对齐", exact: true }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await menu.getByRole("menuitem", { name: /^默认折叠图标/ }).click();
  await menu.getByRole("menuitemcheckbox", { name: "加减号 + / −", exact: true }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-editor:visible .editor-fold-symbol").first()).toHaveText("−");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config") ?? "{}").editor_fold_icon_collapsed)).toBe("+");
  expect(await savedContent()).toBe(before);
  await page.reload();
  await trigger.click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "显示块号", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemcheckbox", { name: "相对块号", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { pluginRuntime } = await load("/src/lib/plugin-system/runtime.ts");
    const { numberingDisplays } = await load("/src/lib/plugin-system/numbering-display.ts");
    const { DEFAULT_NUMBERING_DISPLAYS } = await load("/src/lib/plugin-system/builtin-numbering-display.ts");
    pluginRuntime.setEnabled(true);
    numberingDisplays.register(pluginRuntime.activate("test.rendered-gutter", []), [{ ...DEFAULT_NUMBERING_DISPLAYS.find((item: { target: string }) => item.target === "blocks"), visible: false }]);
  });
  await trigger.click();
  await expect(menu.getByRole("menuitemcheckbox", { name: "显示块号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitemcheckbox", { name: "相对块号", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: /^默认折叠图标/ })).toBeDisabled();
  await expect(menu.getByRole("menuitemcheckbox", { name: "代码块行号", exact: true })).toBeEnabled();
});
