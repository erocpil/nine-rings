import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { sourceInfo } from "../helpers/source-editor";

async function fixture(page: Page, large = false) {
  await createBlankDocument(page, "效率工具前的文档");
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true); saveFileBrowserEnabled(true);
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const roots = await page.evaluate(async largeDirectory => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const file = (path: string, text: string) => { const result = new File([text], path.split("/").pop()!, { lastModified: 5000 }); Object.defineProperty(result, "webkitRelativePath", { value: path }); return result; };
    const left = localFileService.addFiles([file("Left/a.c", "int needle = 1;\n"), file("Left/b.c", "int another = 2;\n"), file("Left/src/deep.c", "int deep = 3;\n"), file("Left/docs/readme.md", "# Read me\n\nbody\n"), file("Left/common.c", "int common = 0;\n"), file("Left/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>'), ...(largeDirectory ? Array.from({ length: 450 }, (_, index) => file(`Left/file-${String(index).padStart(3, "0")}.txt`, `entry ${index}`)) : [])])!;
    const right = localFileService.addFiles([file("Right/common.c", "int common = 0;\n"), file("Right/only.c", "int right = 0;\n")])!;
    return { left, right };
  }, large);
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
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await left.getByRole("tab", { name: "src", exact: true }).click();
  await expect(left.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await left.getByRole("tab", { name: "docs", exact: true }).click();
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("tab", { name: "docs", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await left.getByRole("tab").first().dblclick();
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
  let dialog = page.getByRole("dialog", { name: "批量重命名", exact: true });
  await expect(dialog.getByRole("button", { name: "确认", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "命名模板", exact: true }).fill("{n}-{name}{ext}");
  await expect(dialog.getByLabel("重命名预览", { exact: true })).toContainText("a.c → 1-a.c");
  await expect(left.getByRole("option", { name: /^a.c/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("status")).toContainText("成功 2 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(left.getByRole("option", { name: /^1-a.c/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /^2-b.c/ })).toBeVisible();
});

test("列表增量定位、范围选择和预览快捷键保留当前项与多选反馈", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  const list = left.getByRole("listbox", { name: "文件列表" });
  await list.focus();
  const count = await list.getByRole("option").count();
  await list.press("Home");
  const initial = await list.evaluate(element => element.scrollTop);
  await list.press("ArrowDown");
  expect(await list.evaluate(element => element.scrollTop)).toBe(initial);
  await list.press("Home");
  await list.press("Shift+End");
  await expect(list.getByRole("option", { selected: true })).toHaveCount(count);
  await expect(left.locator('[data-node-id="image.svg"]')).toHaveAttribute("data-current", "true");
  await list.press("Insert");
  await expect(left.locator('[data-node-id="image.svg"]')).toHaveAttribute("aria-selected", "false");
  await list.press("Space");
  const preview = browser.getByRole("region", { name: "快速预览", exact: true });
  await expect(preview.getByRole("img", { name: "image.svg" })).toBeVisible();
  await list.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(right).toBeVisible();
  await list.press("c"); await list.press("o"); await list.press("m");
  await expect(left.locator('[data-node-id="common.c"]')).toHaveAttribute("data-current", "true");
  await expect(list.getByRole("option")).toHaveCount(count);
  await expect(left.getByRole("status")).toContainText("定位：com");
  await list.press("Escape");
  await expect(left.getByRole("status")).toHaveCount(0);
  await expect(browser).toBeVisible();
  await left.getByRole("searchbox", { name: "过滤文件名称" }).fill("common");
  await expect(list.getByRole("option", { selected: true })).toHaveCount(0);
  await left.getByRole("searchbox", { name: "过滤文件名称" }).press("Escape");
  await expect(left.getByRole("searchbox", { name: "过滤文件名称" })).toHaveValue("");
});

test("操作功能键只在列表生效，禁用的复制不会刷新网页", async ({ page }) => {
  const { browser, left } = await fixture(page);
  await page.evaluate(async () => { const { localFileService } = await import("/src/lib/local-files/service.ts"); localFileService.supportsDirectoryChanges = () => true; });
  await left.getByRole("option", { name: /^a.c/ }).click();
  const list = left.getByRole("listbox", { name: "文件列表" });
  await page.evaluate(() => { (window as any).__browserReloadProbe = "kept"; });
  await list.press("F5");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__browserReloadProbe)).toBe("kept");
  await list.press("F2");
  let dialog = page.getByRole("dialog", { name: "重命名", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("with space.c");
  await expect(browser.getByRole("region", { name: "快速预览", exact: true })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "名称", exact: true }).press("Escape");
  await expect(dialog).toHaveCount(0);
  await list.focus(); await list.press("F7");
  dialog = page.getByRole("dialog", { name: "新建文件夹", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(browser).toBeVisible();
});

test("交换保留整组目录标签，同路径只改变另一栏且目录标签支持方向键", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  await left.getByRole("button", { name: "新建目录标签", exact: true }).click();
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("docs");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await browser.getByRole("button", { name: "交换两栏", exact: true }).click();
  await expect(right.getByRole("tab")).toHaveCount(2);
  await expect(right.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /only.c/ })).toBeVisible();
  await expect(browser).toHaveAttribute("data-active-pane", "1");
  await browser.getByRole("button", { name: "两栏同路径", exact: true }).click();
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await left.getByRole("button", { name: "后退目录", exact: true }).click();
  await expect(left.getByRole("option", { name: /only.c/ })).toBeVisible();
  await right.getByRole("tab", { name: "docs", exact: true }).focus();
  await right.getByRole("tab", { name: "docs", exact: true }).press("ArrowLeft");
  await expect(right.getByRole("tab", { name: "src", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(right.getByRole("tab", { name: "src", exact: true })).toBeFocused();
  await expect(right.getByRole("option", { name: /deep.c/ })).toBeVisible();
});

for (const mode of ["light", "dark"] as const) test(`双栏紧凑工具栏与窄列对齐，纸页 ${mode}`, async ({ page }, testInfo) => {
  await page.addInitScript(value => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "paper", interface_color_mode: value, workspace_layout: "exhibition" })), mode);
  const { browser, left } = await fixture(page);
  await expect(browser.getByRole("group", { name: "文件操作", exact: true })).toBeVisible();
  await expect(browser.getByRole("group", { name: "浏览工具", exact: true })).toBeVisible();
  await left.getByRole("option", { name: /^a.c/ }).click();
  await page.screenshot({ path: testInfo.outputPath(`dual-pane-${mode}.png`) });
  await page.setViewportSize({ width: 900, height: 800 });
  const list = left.getByRole("listbox", { name: "文件列表" });
  await list.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(async () => {
    const heading = await left.locator(".file-browser-columns > span").first().boundingBox();
    const cell = await list.locator(".file-browser-row > span").first().boundingBox();
    return heading && cell ? Math.abs(heading.x - cell.x) : Infinity;
  }).toBeLessThan(1);
  expect(await browser.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(left).toBeVisible();
  expect(await browser.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("右键保留多选，复制完整路径使用手势并且反馈不移动列表", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).__browserClipboard = text; } } }));
  await left.getByRole("option", { name: /^a.c/ }).click();
  await left.getByRole("option", { name: /^b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await right.getByRole("listbox", { name: "文件列表" }).focus();
  const before = await left.locator('[data-node-id="a.c"]').boundingBox();
  await left.locator('[data-node-id="a.c"]').click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件菜单", exact: true });
  await expect(left.getByRole("listbox").getByRole("option", { selected: true })).toHaveCount(2);
  await expect(menu.getByRole("menuitem", { name: "重命名", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "复制完整路径", exact: true })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "复制完整路径", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__browserClipboard)).toBe("Left/a.c\nLeft/b.c");
  await expect(left.getByRole("status")).toContainText("已复制完整路径");
  expect((await left.locator('[data-node-id="a.c"]').boundingBox())!.y).toBe(before!.y);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await left.locator('[data-node-id="common.c"]').click({ button: "right" });
  await menu.getByRole("menuitem", { name: "复制名称", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__browserClipboard)).toBe("common.c");
  await expect(left.getByRole("listbox").getByRole("option", { selected: true })).toHaveCount(1);
  await left.getByRole("listbox").focus(); await left.getByRole("listbox").press("Shift+F10");
  await expect(menu).toBeVisible(); await menu.press("Escape");
  await expect(left.getByRole("listbox")).toBeFocused();
  await expect(browser).toBeVisible();
});

test("路径历史与常用目录跨栏复用，输入非法目录不改变当前位置", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  await expect(left.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await left.getByRole("button", { name: "收藏当前目录", exact: true }).click();
  await expect(left.getByRole("button", { name: "收藏当前目录", exact: true })).toHaveAttribute("aria-pressed", "true");
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("docs");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await left.getByRole("button", { name: "路径历史", exact: true }).click();
  await expect(page.getByRole("menu", { name: "路径历史", exact: true })).toBeVisible();
  await left.getByRole("button", { name: "路径历史", exact: true }).click();
  await expect(page.getByRole("menu", { name: "路径历史", exact: true })).toHaveCount(0);
  await left.getByRole("button", { name: "路径历史", exact: true }).click();
  await page.getByRole("menu", { name: "路径历史", exact: true }).getByRole("menuitem", { name: /Left\/src/ }).click();
  await expect(left.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await right.getByRole("button", { name: "常用目录", exact: true }).click();
  await page.getByRole("menu", { name: "常用目录", exact: true }).getByRole("menuitem", { name: "Left/src", exact: true }).click();
  await expect(right.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await right.getByRole("textbox", { name: "根内相对路径" }).fill("../escape");
  await right.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await expect(right.getByRole("alert")).toBeVisible();
  await expect(right.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await expect(browser).toBeVisible();
});

test("标题排序与列宽调整按栏保存，名称默认填满剩余宽度", async ({ page }) => {
  const { browser, panel, left } = await fixture(page);
  await left.getByRole("button", { name: "按大小排序", exact: true }).click();
  await left.getByRole("button", { name: "按大小排序", exact: true }).click();
  await expect(left.getByRole("combobox", { name: "文件排序", exact: true })).toHaveValue("size-desc");
  await expect.poll(() => left.getByRole("listbox").locator(".file-browser-row").evaluateAll(rows => rows[2]?.getAttribute("data-node-id"))).toBe("image.svg");
  const splitter = left.getByRole("separator", { name: "调整大小列宽", exact: true });
  const initial = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus(); await splitter.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", String(initial + 8));
  const bounds = (await splitter.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 32, bounds.y + bounds.height / 2); await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", String(initial + 40));
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("separator", { name: "调整大小列宽", exact: true })).toHaveAttribute("aria-valuenow", String(initial + 40));
  await expect(left.getByRole("combobox", { name: "文件排序", exact: true })).toHaveValue("size-desc");
});

test("近底自动分页失败只尝试一次，手动重试后继续加载且虚拟行有界", async ({ page }) => {
  const { left } = await fixture(page, true);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts"); const list = localFileService.list.bind(localFileService);
    (window as any).__pageAttempts = 0;
    localFileService.list = async (root, node, offset = 0, options) => {
      if (offset === 200) { (window as any).__pageAttempts++; if ((window as any).__pageAttempts === 1) throw new Error("simulated page failure"); }
      return list(root, node, offset, options);
    };
  });
  const list = left.getByRole("listbox", { name: "文件列表" });
  await expect(left.locator(".file-browser-pane-status")).toContainText("200 项");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(left.getByRole("alert")).toContainText("simulated page failure");
  await list.evaluate(element => { element.dispatchEvent(new Event("scroll")); element.dispatchEvent(new Event("scroll")); });
  expect(await page.evaluate(() => (window as any).__pageAttempts)).toBe(1);
  await left.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("400 项");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(left.locator(".file-browser-pane-status")).toContainText("456 项");
  expect(await list.getByRole("option").count()).toBeLessThan(50);
});

test("明确选择递归和正文核验后发现相同元信息中的内容差异，取消拒绝迟到结果", async ({ page }) => {
  const { browser, right } = await fixture(page);
  const root = await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const file = new File(["int deep = 4;\n"], "deep.c", { lastModified: 5000 });
    Object.defineProperty(file, "webkitRelativePath", { value: "Other/src/deep.c" });
    return localFileService.addFiles([file])!;
  });
  await right.getByRole("button", { name: "刷新目录", exact: true }).click();
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption(root.id);
  await browser.getByRole("button", { name: "比较目录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "目录比较", exact: true });
  await expect(dialog.getByRole("status")).toContainText("完成");
  await dialog.getByRole("combobox", { name: "比较递归层数" }).selectOption("1");
  await dialog.getByLabel("核验 UTF-8 正文", { exact: true }).check();
  await dialog.getByRole("button", { name: "重新比较", exact: true }).click();
  const row = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "src/deep.c", exact: true }) });
  await expect(row).toContainText("正文不同");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.locator(".file-browser-comparison-controls").first().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const read = localFileService.readSnapshot.bind(localFileService);
    localFileService.readSnapshot = async (root, node) => { await new Promise<void>(resolve => { (window as any).__finishComparison = resolve; }); return read(root, node); };
  });
  await dialog.getByRole("button", { name: "重新比较", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__finishComparison))).toBe(true);
  await dialog.getByRole("button", { name: "取消比较", exact: true }).click();
  await page.evaluate(() => (window as any).__finishComparison());
  await expect(dialog.getByRole("status")).toContainText("已取消");
  await expect(row).toHaveCount(0);
});

test("目录标签拖动排序、固定、关闭其它和恢复关闭保留独立路径", async ({ page }) => {
  const { browser, panel, left } = await fixture(page);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  const src = left.getByRole("tab", { name: "src", exact: true });
  await src.click({ button: "right" });
  await page.getByRole("menuitem", { name: "固定标签", exact: true }).click();
  await src.dblclick();
  await expect(src).toBeVisible();
  await src.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "关闭标签", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await left.getByRole("button", { name: "新建目录标签", exact: true }).click();
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("docs");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  const docs = left.getByRole("tab", { name: "docs", exact: true });
  await docs.dragTo(src);
  await expect(left.getByRole("tab").first()).toHaveText("docs");
  await expect(docs).toHaveAttribute("aria-selected", "true");
  await docs.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "关闭其它标签", exact: true })).toBeDisabled();
  await page.getByRole("menu", { name: "目录标签菜单" }).press("Escape");
  await left.getByRole("tab").first().dblclick();
  await expect(left.getByRole("option", { name: /deep.c/ })).toBeVisible();
  await left.getByRole("button", { name: "恢复关闭的目录标签", exact: true }).click();
  await expect(left.getByRole("option", { name: /readme.md/ })).toBeVisible();
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("tab").first()).toContainText("src");
  await expect(left.getByRole("tab").last()).toHaveText("docs");
});

test("双栏拖放冻结多选并明确复制或移动目标，不绕过确认及能力门禁", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  const a = left.getByRole("option", { name: /^a.c/ });
  await expect(a).toHaveAttribute("draggable", "false");
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.canTransfer = () => true; localFileService.supportsDirectoryChanges = () => true;
  });
  await a.click();
  await left.getByRole("option", { name: /^b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await a.dragTo(right.getByRole("listbox", { name: "文件列表" }));
  let dialog = page.getByRole("dialog", { name: "复制到另一栏", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Right");
  await expect(dialog).toContainText("2 项");
  await dialog.getByRole("button", { name: "关闭文件操作", exact: true }).click();
  const source = (await a.boundingBox())!, target = (await right.getByRole("listbox", { name: "文件列表" }).boundingBox())!;
  await page.mouse.move(source.x + 40, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 65, source.y + source.height / 2, { steps: 3 });
  await page.keyboard.down("Shift");
  await page.mouse.move(target.x + 40, target.y + 100, { steps: 5 });
  await page.mouse.move(target.x + 42, target.y + 102);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  dialog = page.getByRole("dialog", { name: "移动到另一栏", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭文件操作", exact: true }).click();
  await expect(a).toBeVisible();
  await expect(browser.getByRole("button", { name: "操作队列", exact: true })).toContainText("队列");
  const external = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData("application/x-nine-rings-browser-files", "forged-token"); return data; });
  await right.getByRole("listbox", { name: "文件列表" }).dispatchEvent("drop", { dataTransfer: external });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await external.dispose();
});

test("预览内查找定位、逐项预览与分层 Esc 不改变文档或切入子目录", async ({ page }) => {
  const { browser, left } = await fixture(page);
  const data = await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const source = "Needle [x]\n" + "normal row\n".repeat(150) + "needle\nNeedle\n";
    const file = (path: string, text: string) => { const result = new File([text], path.split("/").pop()!, { lastModified: 5000 }); Object.defineProperty(result, "webkitRelativePath", { value: path }); return result; };
    return { source, root: localFileService.addFiles([file("Preview/a.txt", source), file("Preview/b.txt", "next needle"), file("Preview/folder/hidden.txt", "do not enter")])! };
  });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await left.getByRole("combobox", { name: "选择授权目录" }).selectOption(data.root.id);
  await left.getByRole("option", { name: /^a.txt/ }).click();
  await browser.getByRole("button", { name: "快速预览", exact: true }).click();
  const preview = browser.getByRole("region", { name: "快速预览", exact: true });
  await preview.getByRole("button", { name: "查找预览", exact: true }).click();
  const input = preview.getByRole("searchbox", { name: "查找预览文本" });
  await input.fill("[x]");
  await expect(preview.locator("mark")).toHaveCount(1);
  await input.fill("needle");
  await expect(preview.locator("mark")).toHaveCount(3);
  await preview.getByRole("button", { name: "下一个预览匹配", exact: true }).click();
  await expect.poll(() => preview.locator("pre").evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect(await preview.locator("pre").textContent()).toBe(data.source);
  await preview.getByRole("button", { name: "预览查找区分大小写" }).click();
  await expect(preview.locator("mark")).toHaveCount(1);
  await preview.getByRole("button", { name: "预览下一文件", exact: true }).click();
  await expect(preview.locator("pre")).toContainText("next needle");
  await expect(input).toHaveValue("needle");
  await input.press("ArrowUp");
  await expect(preview.locator("pre")).toContainText("next needle");
  await preview.getByRole("button", { name: "预览上一文件", exact: true }).focus();
  await preview.getByRole("button", { name: "预览上一文件", exact: true }).press("ArrowUp");
  await expect(preview.locator("pre")).toContainText("Needle [x]");
  await preview.getByRole("button", { name: "预览上一文件", exact: true }).click();
  await expect(preview.getByRole("status").filter({ hasText: "没有上一文件" })).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveCount(0); await expect(preview).toBeVisible();
  await expect(preview.locator("mark")).toHaveCount(0);
  await preview.press("ControlOrMeta+f");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("needle");
  await input.press("Escape");
  await preview.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(left.getByRole("listbox")).toBeFocused();
  await expect(left.getByRole("option", { name: /^folder/ })).toBeVisible();
});

test("快速预览图片使用原始像素缩放、双向滚动和适窗，手机不溢出", async ({ page }) => {
  const { browser, left } = await fixture(page);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.readImageAsset = async () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="red"/></svg>');
  });
  await left.getByRole("option", { name: /image.svg/ }).click();
  await browser.getByRole("button", { name: "快速预览", exact: true }).click();
  const preview = browser.getByRole("region", { name: "快速预览", exact: true });
  const image = preview.getByRole("img", { name: "image.svg" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete)).toBe(true);
  await preview.getByRole("button", { name: "200%", exact: true }).click();
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().width)).toBe(6000);
  const viewport = preview.getByLabel("预览图片可滚动区域", { exact: true });
  await viewport.evaluate(element => { element.scrollTop = 120; element.scrollLeft = 120; });
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(100, 100);
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(120);
  await viewport.dispatchEvent("wheel", { deltaY: -20, ctrlKey: true });
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(6000);
  await viewport.evaluate(element => {
    element.dispatchEvent(new Event("gesturestart", { cancelable: true }));
    const event = new Event("gesturechange", { cancelable: true }); Object.defineProperty(event, "scale", { value: 2 }); element.dispatchEvent(event);
    element.dispatchEvent(new Event("gestureend", { cancelable: true }));
  });
  await expect(preview.getByLabel("预览缩放比例", { exact: true })).toHaveText("400%");
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.getByRole("button", { name: "适窗", exact: true }).click();
  await expect.poll(() => viewport.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThan(2);
  await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(2);
  expect(await browser.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("选中大小只汇总已知文件，目录不递归也不冒充零字节", async ({ page }) => {
  const { left } = await fixture(page);
  await left.getByRole("option", { name: /^a.c/ }).click();
  await left.getByRole("option", { name: /^b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await left.getByRole("option", { name: /^src/ }).click({ modifiers: ["ControlOrMeta"] });
  const summary = left.getByLabel("选中大小", { exact: true });
  await expect(summary).toContainText("33 B");
  await expect(summary).toContainText("1 目录未统计内部");
  await expect(summary).toHaveAttribute("title", /已知 2 个文件/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await left.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("原始字节比较支持二进制，默认与正文模式分开，超预算保持未知", async ({ page }) => {
  const { browser, left, right } = await fixture(page);
  const roots = await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const file = (path: string, bytes: Uint8Array) => { const result = new File([new Uint8Array(bytes).buffer], path.split("/").pop()!, { lastModified: 5000 }); Object.defineProperty(result, "webkitRelativePath", { value: path }); return result; };
    const large = new Uint8Array(17 * 1024 * 1024);
    return ["L", "R"].map(root => localFileService.addFiles([file(`${root}/equal.bin`, new Uint8Array([0, 255, 1])), file(`${root}/different.bin`, new Uint8Array([0, root === "L" ? 255 : 254, 1])), file(`${root}/large.bin`, large)])!);
  });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await left.getByRole("combobox", { name: "选择授权目录" }).selectOption(roots[0].id);
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption(roots[1].id);
  await browser.getByRole("button", { name: "比较目录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "目录比较", exact: true });
  const row = (name: string) => dialog.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });
  await expect(row("different.bin")).toContainText("元信息一致");
  await dialog.getByLabel("核验 UTF-8 正文", { exact: true }).check();
  await dialog.getByRole("button", { name: "重新比较", exact: true }).click();
  await expect(row("equal.bin")).toContainText("未知");
  await expect(dialog.getByRole("status")).toContainText("完成");
  await dialog.getByLabel("核验原始字节（含二进制）", { exact: true }).check();
  await expect(dialog.getByLabel("核验 UTF-8 正文", { exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "重新比较", exact: true }).click();
  await expect(row("equal.bin")).toContainText("字节相同");
  await expect(row("different.bin")).toContainText("字节不同");
  await expect(row("large.bin")).toContainText("未知");
  await expect(row("large.bin")).toContainText("16 MiB");
});
