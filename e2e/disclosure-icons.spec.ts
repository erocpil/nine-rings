import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openMobileSettings } from "./helpers/mobile-settings";

test("文本区折叠箭头与文档树一致，方向跟随折叠状态", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 标题\n\n正文\n\n> 引用\n\n```text\n代码\n```");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  const treePath = await page.locator(".doc-tree-folder-chevron path").first().getAttribute("d");
  const fold = page.getByRole("button", { name: "折叠第 1 块章节", exact: true });
  await expect(fold.locator("path")).toHaveAttribute("d", treePath!);
  await expect(fold.locator(".disclosure-icon")).toHaveClass(/expanded/);
  await expect(fold).toHaveText("");
  await fold.click();
  const expand = page.getByRole("button", { name: "展开第 1 块章节", exact: true });
  await expect(expand.locator(".disclosure-icon")).not.toHaveClass(/expanded/);
  await expect(editor.getByText("正文", { exact: true })).toBeHidden();
  await expand.click();
  await expect(editor.getByText("正文", { exact: true })).toBeVisible();
  for (const kind of ["引用块", "代码块"]) {
    const collapse = page.getByRole("button", { name: `折叠${kind}`, exact: true });
    await expect(collapse.locator("path")).toHaveAttribute("d", treePath!);
    await collapse.click();
    const reopen = page.getByRole("button", { name: `展开${kind}`, exact: true });
    await expect(reopen.locator(".disclosure-icon")).not.toHaveClass(/expanded/);
    await reopen.click();
  }
});

test("设置原生详情项使用统一箭头，点击与键盘仍可展开收起", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^Vim 设置/ }).click();
  const summary = page.locator("summary").filter({ hasText: "高级 set 配置" });
  const icon = summary.locator(".disclosure-icon");
  await expect(summary).toHaveCSS("list-style-type", "none");
  await expect(icon).toHaveCSS("transform", "none");
  await summary.click();
  await expect(icon).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
  await expect(page.getByRole("textbox", { name: "Vim set 配置" })).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(icon).toHaveCSS("transform", "none");
  await expect(page.getByRole("textbox", { name: "Vim set 配置" })).toBeHidden();
});

test("编辑器折叠标识支持预设、自定义、立即应用及重启保留", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 标题\n\n正文\n\n> 引用\n\n```text\n代码\n```");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  const openSettings = async () => {
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与排版/ }).click();
    await page.getByRole("button", { name: /^编辑器设置/ }).click();
  };
  await openSettings();
  const style = page.getByRole("combobox", { name: "折叠标识样式" });
  await expect(style).toHaveValue("chevron");
  await style.selectOption("triangle");
  await expect(page.getByLabel("折叠标识预览").locator(".editor-fold-symbol")).toHaveText(["▶", "▼"]);
  await page.locator(".settings-close").click();
  await expect(page.getByRole("button", { name: "折叠第 1 块章节", exact: true })).toHaveText("▼");
  await openSettings();
  await style.selectOption("custom");
  await page.getByRole("textbox", { name: "收起状态符号" }).fill("+");
  await page.getByRole("textbox", { name: "展开状态符号" }).fill("−");
  await expect(page.getByLabel("折叠标识预览").locator(".editor-fold-symbol")).toHaveText(["+", "−"]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config") || "{}").editor_fold_icon_expanded)).toBe("−");
  await page.locator(".settings-close").click();
  for (const name of ["折叠第 1 块章节", "折叠引用块", "折叠代码块"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveText("−");
  }
  await expect(page.locator(".doc-tree-folder-chevron").first().locator("svg")).toBeVisible();
  await page.getByTitle("文档目录", { exact: true }).click();
  await expect(page.getByRole("button", { name: "折叠章节 标题", exact: true })).toHaveText("−");
  await page.getByRole("button", { name: "折叠章节 标题", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开章节 标题", exact: true })).toHaveText("+");
  await page.getByRole("button", { name: "展开章节 标题", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "折叠第 1 块章节", exact: true })).toHaveText("−");
  await openSettings();
  await expect(style).toHaveValue("custom");
  await expect(page.getByRole("textbox", { name: "收起状态符号" })).toHaveValue("+");
  await style.selectOption("chevron");
  await page.locator(".settings-close").click();
  await expect(page.getByRole("button", { name: "折叠第 1 块章节", exact: true }).locator(".disclosure-icon.expanded")).toBeVisible();
});

test("手机自定义折叠符号在只读正文和目录中生效", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({
    editor_fold_icon_style: "custom", editor_fold_icon_collapsed: "+", editor_fold_icon_expanded: "−",
  })));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.create({ title: "手机折叠符号", date: "2026-09-17", content: { ops: [
      { insert: "标题" }, { insert: "\n", attributes: { header: 1 } }, { insert: "正文\n" },
    ] } });
    useNotesStore.getState().selectNote(await api.notes.update(note.id, { readonly: true }));
  });
  const fold = page.getByRole("button", { name: "折叠第 1 块章节", exact: true });
  await expect(fold).toHaveText("−");
  await fold.click();
  await expect(page.getByRole("button", { name: "展开第 1 块章节", exact: true })).toHaveText("+");
  await page.getByTitle("文档目录", { exact: true }).click();
  await expect(page.getByRole("button", { name: "展开章节 标题", exact: true })).toHaveText("+");
  await page.getByRole("button", { name: "展开章节 标题", exact: true }).click();
  await page.getByTitle("文档目录", { exact: true }).click();
  await openMobileSettings(page);
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
  await expect(page.getByRole("combobox", { name: "折叠标识样式" })).toHaveValue("custom");
  await expect(page.getByLabel("折叠标识预览").locator(".editor-fold-symbol")).toHaveText(["+", "−"]);
});
