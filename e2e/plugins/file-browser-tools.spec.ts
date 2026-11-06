import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { sourceInfo } from "../helpers/source-editor";

async function fixture(page: Page) {
  await createBlankDocument(page, "效率工具前的文档");
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const roots = await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const file = (path: string, text: string) => { const result = new File([text], path.split("/").pop()!, { lastModified: 5000 }); Object.defineProperty(result, "webkitRelativePath", { value: path }); return result; };
    const left = localFileService.addFiles([file("Left/a.c", "int needle = 1;\n"), file("Left/b.c", "int another = 2;\n"), file("Left/src/deep.c", "int deep = 3;\n"), file("Left/docs/readme.md", "# Read me\n\nbody\n"), file("Left/common.c", "int common = 0;\n"), file("Left/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>')])!;
    const right = localFileService.addFiles([file("Right/common.c", "int common = 0;\n"), file("Right/only.c", "int right = 0;\n")])!;
    return { left, right };
  });
  const panel = page.getByRole("region", { name: "本地文件树", exact: true });
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  const left = browser.getByRole("region", { name: "左侧目录", exact: true }), right = browser.getByRole("region", { name: "右侧目录", exact: true });
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption(roots.right.id);
  return { browser, panel, left, right, roots };
}
test("每栏目录标签独立保留历史并在重新进入时恢复", async ({ page }) => {
  const { browser, panel, left } = await fixture(page);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  await left.getByRole("button", { name: "新建目录标签", exact: true }).click();
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("docs");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await left.getByRole("tab", { name: "src", exact: true }).click();
  await expect(left.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await left.getByRole("tab", { name: "docs", exact: true }).click();
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("tab", { name: "docs", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await left.getByRole("button", { name: "关闭目录标签 1", exact: true }).click();
  await expect(left.getByRole("tab")).toHaveCount(1);
});
test("快速预览跟随选中项，迟到文本不覆盖新预览，手机可返回目录", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const read = localFileService.readSnapshot.bind(localFileService);
    (window as any).__previewFinish = null;
    localFileService.readSnapshot = async (root, node) => { if (node === "a.c") await new Promise<void>(resolve => { (window as any).__previewFinish = resolve; }); return read(root, node); };
  });
  await left.getByRole("option", { name: /^a.c/ }).click();
  await browser.getByRole("button", { name: "快速预览", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__previewFinish))).toBe(true);
  await left.getByRole("option", { name: /^b.c/ }).click();
  const preview = browser.getByRole("region", { name: "快速预览", exact: true });
  await expect(preview.locator("pre")).toContainText("int another");
  await page.evaluate(() => (window as any).__previewFinish());
  await expect(preview.locator("pre")).toContainText("int another");
  await expect(right).toBeHidden();
  await left.getByRole("option", { name: /image.svg/ }).click();
  await expect(preview.getByRole("img", { name: "image.svg" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "关闭快速预览", exact: true }).click();
  await expect(left).toBeVisible();
  expect(await browser.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
test("目录比较区分当前层元信息与正文，正文搜索打开匹配位置并可返回", async ({ page }) => {
  const { browser, left } = await fixture(page);
  await left.getByRole("listbox", { name: "文件列表" }).focus();
  await browser.getByRole("button", { name: "比较目录", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "目录比较", exact: true });
  await expect(compare.getByRole("status")).toContainText("完成");
  await expect(compare.getByRole("row").filter({ has: page.getByRole("cell", { name: "common.c", exact: true }) })).toContainText("元信息一致");
  await expect(compare.getByRole("row").filter({ has: page.getByRole("cell", { name: "only.c", exact: true }) })).toContainText("仅右侧");
  await compare.getByRole("button", { name: "关闭目录比较", exact: true }).click();
  await browser.getByRole("button", { name: "搜索正文", exact: true }).click();
  const search = page.getByRole("dialog", { name: "目录搜索", exact: true });
  await search.getByRole("textbox", { name: "搜索本地文件正文", exact: true }).fill("needle");
  await search.getByRole("button", { name: "开始全文搜索", exact: true }).click();
  await expect(search.getByRole("status").filter({ hasText: "搜索完成" })).toBeVisible();
  await search.locator(".local-file-search-hit").click();
  const editor = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(editor).toBeVisible();
  await expect.poll(() => sourceInfo(editor).then(value => value.value.slice(value.selectionStart, value.selectionEnd))).toBe("needle");
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(browser).toBeVisible();
});
test("批量重命名先预览，再按选中顺序执行且保留扩展名", async ({ page }) => {
  const { browser, left } = await fixture(page);
  // Writable service facade for this UI test; actual exclusive native moves
  // remain covered by Rust tests. Production snapshots keep this button disabled.
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.supportsDirectoryChanges = () => true;
    localFileService.move = async (root, node, _parent, name) => (await localFileService.rename(root, node, name)).nodeId;
  });
  await left.getByRole("option", { name: /^a.c/ }).click();
  await left.getByRole("option", { name: /^b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "批量重命名", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "批量重命名", exact: true });
  await expect(dialog.getByRole("button", { name: "确认", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "命名模板", exact: true }).fill("{n}-{name}{ext}");
  await expect(dialog.getByLabel("重命名预览", { exact: true })).toContainText("a.c → 1-a.c");
  await expect(left.getByRole("option", { name: /^a.c/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("成功 2 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(left.getByRole("option", { name: /^1-a.c/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /^2-b.c/ })).toBeVisible();
});
