import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nr-workbench-e2e-"));
  await mkdir(join(directory, "sub"));
  await writeFile(join(directory, "large.txt"), "Text source line.\n".repeat(70000) + "END-LARGE-SOURCE\n");
  await writeFile(join(directory, ".secret"), "hidden\n");
  await writeFile(join(directory, "alpha.c"), "int alpha(void) { return 42; }\n");
  await writeFile(join(directory, "sub", "guide.md"), "# Guide\n\nShared browser search target.\n");
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("原生退出先提示再确认，菜单监听在 ready 前完成且托盘退出仍走离开门禁", async ({ page }) => {
  await page.addInitScript(() => {
    let next = 1;
    const callbacks = new Map<number, (event: unknown) => void>();
    const handlers: Record<string, number> = {};
    Object.assign(window, { workbenchQuitCalls: [] });
    (window as any).workbenchEmit = (event: string) => callbacks.get(handlers[event])?.({ event, id: 1, payload: null });
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback(callback: (event: unknown) => void) { const id = next++; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") { handlers[args.event] = args.handler; return next++; }
        if (command === "workbench_ready") {
          if (!handlers["workbench:request-close"] || !handlers["workbench:confirm-quit"]) throw new Error("quit listeners not ready");
          return;
        }
        if (command === "workbench_confirm_close") { (window as any).workbenchQuitCalls.push("quit"); return; }
        if (["plugin:event|unlisten", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [];
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  await expect(page.getByRole("button", { name: "添加工具", exact: true })).toBeVisible();
  const press = (event = "workbench:confirm-quit") => page.evaluate(event => (window as any).workbenchEmit(event), event);
  await press();
  const hint = page.locator(".quit-confirmation-hint");
  await expect(hint).toHaveText("再次按下 ⌘Q 退出（2 秒内）");
  expect((await hint.boundingBox())!.y).toBeLessThan(140);
  expect(await page.evaluate(() => (window as any).workbenchQuitCalls)).toEqual([]);
  await press();
  await expect.poll(() => page.evaluate(() => (window as any).workbenchQuitCalls)).toEqual(["quit"]);
  await expect(hint).toHaveCount(0);
  await press("workbench:request-close");
  await expect.poll(() => page.evaluate(() => (window as any).workbenchQuitCalls)).toEqual(["quit", "quit"]);
});

test("不依赖文件参数的桌面工具无需先选择目录", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 1;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [];
        if (command === "workbench_run_tool") { if (args.operation === "prepare") return { program: args.command, arguments: args.arguments, directory: null }; (window as any).__genericToolArgs = args; return 4321; }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "工具栏工具", exact: true });
  await dialog.getByRole("textbox", { name: "工具名称", exact: true }).fill("通用工具");
  await dialog.getByRole("textbox", { name: "工具命令", exact: true }).fill("utility");
  await dialog.getByRole("textbox", { name: "工具参数", exact: true }).fill("--version");
  await dialog.getByRole("button", { name: "保存工具", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "通用工具", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "使用配置参数运行", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工具执行", exact: true })).toContainText('"utility" "--version"');
  await expect.poll(() => page.evaluate(() => (window as any).__genericToolArgs)).toBeUndefined();
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__genericToolArgs)).toEqual({ command: "utility", arguments: ["--version"], rootId: null, node: "", selected: [], targetRootId: null, targetNode: null, expectedPlan: { program: "utility", arguments: ["--version"], directory: null } });
  await expect(page.getByRole("dialog", { name: "工具执行", exact: true }).getByRole("status")).toContainText("PID 4321");
});

test("工具栏配置分组图标与 Unicode 持久化，目录区可叠放并保留独立路径，标签可拖动", async ({ page }, testInfo) => {
  await page.goto("/file-workbench.html");
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "工具栏工具", exact: true });
  await tools.getByRole("textbox", { name: "工具名称", exact: true }).fill("自定义编辑器");
  await tools.getByRole("textbox", { name: "工具命令", exact: true }).fill("editor");
  await tools.getByRole("textbox", { name: "工具参数", exact: true }).fill("--file\n{file}");
  await tools.getByRole("textbox", { name: "工具提示", exact: true }).fill("编辑当前选中文件");
  await tools.getByRole("combobox", { name: "图标分组", exact: true }).selectOption("编辑与操作");
  await tools.getByRole("button", { name: "使用图标 edit", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("custom-tool-config.png") });
  await tools.getByRole("button", { name: "保存工具", exact: true }).click();
  const checkNotice = async () => {
    const notice = page.locator(".workbench-tool-notice");
    await expect(notice).toContainText("工具已保存");
    const bounds = await notice.boundingBox(), viewport = page.viewportSize()!;
    expect(bounds!.y).toBeGreaterThan(viewport.height / 2);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 12);
    expect(bounds!.x).toBeGreaterThanOrEqual(12);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 12);
    await notice.getByRole("button", { name: "关闭工具结果", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(tools).toBeVisible();
    expect(await tools.evaluate(element => element.contains(document.activeElement))).toBe(true);
  };
  await checkNotice();
  await tools.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "自定义编辑器", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  await tools.getByRole("button", { name: "自定义编辑器", exact: true }).click();
  await tools.getByRole("combobox", { name: "图标来源", exact: true }).selectOption("unicode");
  await tools.getByRole("textbox", { name: "Unicode 图标", exact: true }).fill("🛠");
  await page.setViewportSize({ width: 375, height: 812 });
  await tools.getByRole("button", { name: "保存工具", exact: true }).click();
  await checkNotice();
  await tools.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "自定义编辑器", exact: true })).toContainText("🛠");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  await expect.poll(() => page.locator(".workspace-dialog-backdrop").evaluate(element => { const style = getComputedStyle(element); return style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter"); })).toBe("blur(1px)");
  await tools.getByRole("button", { name: "自定义编辑器", exact: true }).click();
  await tools.getByRole("combobox", { name: "图标来源", exact: true }).selectOption("image");
  await tools.getByLabel("导入工具图标", { exact: true }).setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=", "base64") });
  await expect(tools.locator(".workbench-tool-icon-preview img")).toHaveCount(1);
  await tools.getByRole("button", { name: "保存工具", exact: true }).click();
  await tools.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "自定义编辑器", exact: true }).locator("img")).toHaveAttribute("src", /^data:image\/png/);
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const first = browser.getByRole("region", { name: "左侧目录", exact: true });
  await first.getByRole("button", { name: "纵向目录数", exact: true }).click();
  await page.getByRole("menuitem", { name: "2 个目录", exact: true }).click();
  const second = browser.getByRole("region", { name: "左侧目录 2", exact: true });
  await second.getByRole("option", { name: /^sub/ }).dblclick();
  await expect(second.getByRole("option", { name: /guide.md/ })).toBeVisible();
  await expect(first.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  await second.getByRole("button", { name: "纵向目录数", exact: true }).click();
  await page.getByRole("menuitem", { name: "1 个目录", exact: true }).click();
  await expect(second).toHaveCount(0);
  await first.getByRole("button", { name: "纵向目录数", exact: true }).click();
  await page.getByRole("menuitem", { name: "2 个目录", exact: true }).click();
  await expect(second.getByRole("option", { name: /guide.md/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("stacked-directories.png") });
  await first.getByRole("button", { name: "新建目录标签", exact: true }).click();
  await first.getByRole("option", { name: /^sub/ }).dblclick();
  const tabs = first.getByRole("tab"), source = await tabs.nth(1).boundingBox(), target = await tabs.nth(0).boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(tabs.nth(0)).toHaveText("sub");
  await expect(first.getByRole("option", { name: /guide.md/ })).toBeVisible();
});

test("双击预览左右键跨文本与图片，只读可切换，编辑方向键不抢占且未保存须确认", async ({ page }) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    (window as any).__releasedPreviewUrls = [];
    URL.revokeObjectURL = url => { (window as any).__releasedPreviewUrls.push(url); revoke(url); };
  });
  const fixture = await mkdtemp(join(tmpdir(), "nr-workbench-continuous-"));
  try {
    await writeFile(join(fixture, "a.txt"), "first\n");
    await writeFile(join(fixture, "b.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=", "base64"));
    await writeFile(join(fixture, "c.md"), "# Last\n"); await writeFile(join(fixture, "d.zip"), "not previewable");
    await page.goto("/file-workbench.html");
    const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
    await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(fixture);
    await browser.getByRole("option", { name: /^a.txt/ }).dblclick();
    const text = page.getByRole("region", { name: "文件源码工作区", exact: true });
    await expect(text.locator(".cm-content")).toContainText("first");
    await text.locator(".cm-content").click(); await page.keyboard.press("ArrowRight");
    const image = page.getByRole("region", { name: "快速预览", exact: true });
    const picture = image.getByRole("img", { name: "b.png", exact: true });
    await expect(picture).toBeVisible();
    const imageUrl = await picture.getAttribute("src");
    expect(imageUrl).toMatch(/^blob:/);
    await page.keyboard.press("ArrowRight"); await expect(text.locator(".cm-content")).toContainText("Last");
    await expect.poll(() => page.evaluate(() => (window as any).__releasedPreviewUrls)).toContain(imageUrl);
    await expect(text.getByRole("button", { name: "下一文件", exact: true })).toBeDisabled();
    await text.getByRole("button", { name: "允许编辑", exact: true }).click();
    await text.locator(".cm-content").click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.insertText("unsaved");
    await page.keyboard.press("ArrowLeft"); await expect(text.locator(".cm-content")).toContainText("unsaved");
    await text.getByRole("button", { name: "上一文件", exact: true }).click();
    const leave = page.getByRole("dialog", { name: "未保存的文件编辑", exact: true });
    await expect(leave).toBeVisible(); await leave.getByRole("button", { name: "取消", exact: true }).click();
    await expect(text.locator(".cm-content")).toContainText("unsaved");
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("文本和图片预览使用关闭图标与快速提示，关闭恢复文件焦点和双轴滚动", async ({ page }) => {
  const fixture = await mkdtemp(join(tmpdir(), "nr-workbench-preview-"));
  try {
    for (let index = 0; index < 44; index++) await writeFile(join(fixture, `${String(index).padStart(2, "0")}.txt`), `text ${index}\n`);
    await writeFile(join(fixture, "44.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=", "base64"));
    await page.setViewportSize({ width: 780, height: 600 });
    await page.goto("/file-workbench.html");
    const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
    await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(fixture);
    const left = browser.getByRole("region", { name: "左侧目录", exact: true });
    const list = left.getByRole("listbox", { name: "文件列表", exact: true });
    await expect(left.getByRole("option", { name: /^00.txt/ })).toBeVisible();
    await list.focus(); await list.press("End");
    await expect(left.getByRole("option", { name: /^44.png/ })).toHaveAttribute("aria-selected", "true");
    await list.evaluate(element => { element.scrollLeft = 50; });
    const scroll = await list.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
    expect(scroll.top).toBeGreaterThan(0); expect(scroll.left).toBeGreaterThan(0);
    const bars = await list.evaluate(element => { const style = getComputedStyle(element, "::-webkit-scrollbar"); return { width: style.width, height: style.height }; });
    expect(bars).toEqual({ width: "6px", height: "6px" });
    await list.press("Enter");
    const image = page.getByRole("region", { name: "快速预览", exact: true });
    await expect(image.getByRole("img", { name: "44.png", exact: true })).toBeVisible();
    await expect(image.getByRole("button", { name: "预览下一文件", exact: true })).toHaveCount(0);
    const imageClose = image.getByRole("button", { name: "返回文件浏览", exact: true });
    const closeIcon = await imageClose.locator("svg").innerHTML();
    await imageClose.hover();
    await expect(page.getByRole("tooltip")).toHaveText("关闭预览，返回文件浏览");
    await imageClose.click(); await expect(list).toBeFocused();
    await expect.poll(() => list.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual(scroll);
    await list.press("ArrowUp");
    await expect(left.getByRole("option", { name: /^43.txt/ })).toHaveAttribute("aria-selected", "true");
    await list.press("Enter");
    const text = page.getByRole("region", { name: "文件源码工作区", exact: true });
    await expect(text.locator(".cm-content")).toContainText("text 43");
    const edit = text.getByRole("button", { name: "允许编辑", exact: true });
    await edit.hover(); await expect(page.getByRole("tooltip")).toHaveText("允许编辑");
    const textClose = text.getByRole("button", { name: "返回文件浏览", exact: true });
    expect(await textClose.locator("svg").innerHTML()).toBe(closeIcon);
    await textClose.hover(); await expect(page.getByRole("tooltip")).toHaveText("关闭预览，返回文件浏览");
    await textClose.click(); await expect(list).toBeFocused();
    await list.press("ArrowUp");
    await expect(left.getByRole("option", { name: /^42.txt/ })).toHaveAttribute("aria-selected", "true");
    await list.press("End"); await list.press("Enter");
    await expect(image).toBeFocused(); await page.keyboard.press("Escape");
    await expect(list).toBeFocused();
    const right = browser.getByRole("region", { name: "右侧目录", exact: true });
    await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption(await left.getByRole("combobox", { name: "选择授权目录", exact: true }).inputValue());
    const rightList = right.getByRole("listbox", { name: "文件列表", exact: true });
    await right.getByRole("option", { name: /^00.txt/ }).dblclick();
    await textClose.click(); await expect(rightList).toBeFocused();
    await rightList.press("ArrowDown");
    await expect(right.getByRole("option", { name: /^01.txt/ })).toHaveAttribute("aria-selected", "true");
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("柔和配色和清雅/物哀在浏览、编辑与重启后保持一致", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("nr:theme", "original-theme"));
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const backgrounds = new Set<string>();
  for (const [label, id] of [["柔和浅色", "light"], ["柔和深色", "dark"], ["清雅", "calm"], ["物哀", "mono-aware"]]) {
    await page.getByRole("button", { name: "配色", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(label + "$") }).click();
    await expect(page.locator("html")).toHaveAttribute("data-workbench-palette", id);
    const color = await page.locator("main").evaluate(element => getComputedStyle(element).backgroundColor);
    expect(color).not.toBe("rgb(255, 255, 255)"); expect(color).not.toBe("rgb(0, 0, 0)");
    backgrounds.add(color);
    await page.screenshot({ path: testInfo.outputPath(`palette-${id}.png`) });
  }
  expect(backgrounds.size).toBe(4);
  await browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /alpha.c/ }).dblclick();
  await page.getByRole("button", { name: "配色", exact: true }).click();
  await page.getByRole("menuitem", { name: "清雅", exact: true }).click();
  await page.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-workbench-palette", "calm");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-workbench-palette", "calm");
  expect(await page.evaluate(() => localStorage.getItem("nr:theme"))).toBe("original-theme");
});

test("桌面目录复制、重命名和移动走确认队列，运行中不退出，恢复草稿阻止路径变更", async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>(); let sequence = 1, close = 0;
    const tree: Record<string, { directory: boolean; content?: string }> = { folder: { directory: true }, "folder/a.c": { directory: false, content: "int original;\n" }, "folder/.hidden": { directory: false, content: "hidden" }, target: { directory: true } };
    const state = { tree, calls: [] as Array<{ command: string; args: any }>, confirmed: 0, hold: true };
    (window as any).__workbenchOps = state;
    (window as any).__workbenchOpsClose = () => callbacks.get(close)?.({ event: "workbench:request-close", payload: null });
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback(callback: (value: unknown) => void) { const id = sequence++; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") { if (args.event === "workbench:request-close") close = args.handler; return sequence++; }
        if (command === "plugin:event|unlisten" || command === "workbench_ready" || command === "workbench_set_view_menu") return;
        if (command === "workbench_confirm_close") { state.confirmed++; return; }
        if (command === "local_files_roots") return [{ id: "native-root", name: "Native" }];
        if (command === "local_files_display_path") return `/fixture/${args.node ?? ""}`;
        if (command === "local_files_stat") return { size: tree[args.node]?.content?.length ?? 0, modifiedMs: 10 };
        if (command === "local_files_read") return { source: tree[args.node]?.content ?? "", revision: "r1", bom: false, lineEnding: "lf", size: tree[args.node]?.content?.length ?? 0, modifiedMs: 10 };
        if (command === "local_files_list") {
          const prefix = args.node ? args.node + "/" : "";
          return { nodes: Object.entries(tree).filter(([path]) => path.startsWith(prefix) && path !== args.node && !path.slice(prefix.length).includes("/") && (args.options?.showHidden || !path.split("/").pop()!.startsWith("."))).map(([id, value]) => ({ id, name: id.split("/").pop(), directory: value.directory, size: value.content?.length ?? 0, modifiedMs: 10 })), next: null };
        }
        if (command === "local_files_transfer" || command === "local_files_move") {
          state.calls.push({ command, args });
          if (state.hold && command === "local_files_transfer") { state.hold = false; await new Promise<void>(resolve => { (window as any).__workbenchOpsRelease = resolve; }); }
          const target = [args.parent, args.name].filter(Boolean).join("/");
          if (tree[target]) throw new Error("TARGET_EXISTS");
          for (const [path, value] of Object.entries(tree)) if (path === args.node || path.startsWith(args.node + "/")) { tree[target + path.slice(args.node.length)] = { ...value }; if (command === "local_files_move" || args.moving) delete tree[path]; }
          return target;
        }
        throw new Error("Unexpected command: " + command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  const left = browser.getByRole("region", { name: "左侧目录", exact: true }), rightFirst = browser.getByRole("region", { name: "右侧目录", exact: true });
  // Rename is local to one pane and must work before the other pane is chosen.
  const menu = page.getByRole("menu", { name: "文件菜单", exact: true });
  await left.getByRole("option", { name: /^folder/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByRole("dialog", { name: "重命名", exact: true }).getByRole("textbox", { name: "名称", exact: true }).fill("package");
  await page.getByRole("dialog", { name: "重命名", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__workbenchOps.tree["package/a.c"]))).toBe(true);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await left.getByRole("button", { name: "纵向目录数", exact: true }).click();
  await page.getByRole("menuitem", { name: "2 个目录", exact: true }).click();
  const leftSecond = browser.getByRole("region", { name: "左侧目录 2", exact: true });
  await left.getByRole("option", { name: /^package/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  await expect(left.getByRole("option", { name: /^a.c/ })).toBeVisible();
  await rightFirst.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption("native-root");
  await rightFirst.getByRole("button", { name: "纵向目录数", exact: true }).click();
  await page.getByRole("menuitem", { name: "2 个目录", exact: true }).click();
  const right = browser.getByRole("region", { name: "右侧目录 2", exact: true });
  await right.getByRole("option", { name: /^target/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  await leftSecond.getByRole("option", { name: /^package/ }).click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "快速预览", exact: true })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchOps.calls.length)).toBe(2);
  await page.evaluate(() => (window as any).__workbenchOpsClose());
  expect(await page.evaluate(() => (window as any).__workbenchOps.confirmed)).toBe(0);
  await page.evaluate(() => (window as any).__workbenchOpsRelease());
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__workbenchOps.tree["target/package/.hidden"]))).toBe(true);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await expect(right.getByRole("option", { name: /^package/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /^a.c/ })).toBeVisible();
  await left.getByRole("button", { name: "上级目录", exact: true }).click();
  await left.getByRole("option", { name: /^package/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "重命名", exact: true });
  await rename.getByRole("textbox", { name: "名称", exact: true }).fill("renamed");
  await rename.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__workbenchOps.tree["renamed/a.c"]))).toBe(true);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await left.getByRole("option", { name: /^renamed/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "移动到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "移动到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__workbenchOps.tree["target/renamed/a.c"]) && !(window as any).__workbenchOps.tree["renamed"])).toBe(true);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await expect(left.getByRole("option", { name: /^renamed/ })).toHaveCount(0);
  await right.getByRole("option", { name: /^renamed/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  await right.getByRole("option", { name: /^a.c/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await view.getByRole("button", { name: "允许编辑", exact: true }).click();
  await view.locator(".cm-content").click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("int unsaved;\n");
  await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await page.getByRole("dialog", { name: "未保存的文件编辑", exact: true }).getByRole("button", { name: "保留草稿后继续", exact: true }).click();
  await right.getByRole("button", { name: "上级目录", exact: true }).click();
  await right.getByRole("option", { name: /^renamed/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await rename.getByRole("textbox", { name: "名称", exact: true }).fill("protected");
  await rename.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "文件操作队列", exact: true })).toContainText("存在未处理的恢复草稿");
  expect(await page.evaluate(() => (window as any).__workbenchOps.calls.length)).toBe(4);
});

test("工作台地址和过滤快捷键只作用于当前栏，保留可见过滤条件并正确显示空文件", async ({ page }) => {
  const fixture = await mkdtemp(join(tmpdir(), "nr-workbench-filter-"));
  try {
    await writeFile(join(fixture, "empty.txt"), "");
    await writeFile(join(fixture, "alpha.c"), "int alpha;\n");
    await page.goto("/file-workbench.html");
    const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
    await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(fixture);
    const left = browser.getByRole("region", { name: "左侧目录", exact: true });
    const right = browser.getByRole("region", { name: "右侧目录", exact: true });
    const list = left.getByRole("listbox", { name: "文件列表", exact: true });
    await expect(left.getByRole("option", { name: /empty.txt/ })).toContainText("0 B");
    const root = await left.getByRole("combobox", { name: "选择授权目录", exact: true }).inputValue();
    await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption(root);
    await list.focus(); await list.press("ControlOrMeta+l");
    const address = left.getByRole("textbox", { name: "根内相对路径", exact: true });
    await expect(address).toBeFocused(); await address.fill("does-not-exist"); await address.press("Escape");
    await expect(address).toHaveCount(0);
    await list.focus(); await list.press("ControlOrMeta+f");
    const filter = left.getByRole("searchbox", { name: "过滤文件名称", exact: true });
    await expect(filter).toBeFocused(); await filter.fill("alpha");
    await expect(list.getByRole("option")).toHaveCount(1);
    await filter.press("Enter"); await expect(list).toBeFocused();
    await expect(filter).toHaveCount(0);
    await expect(left.locator(".file-browser-active-filter")).toContainText("alpha");
    await expect(right.getByRole("listbox", { name: "文件列表", exact: true }).getByRole("option")).toHaveCount(2);
    await list.press("Escape");
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(left.locator(".file-browser-active-filter")).toHaveCount(0);
    await list.press("ControlOrMeta+f"); await filter.fill("no-such-file");
    await expect(left.getByText("没有匹配的文件或目录", { exact: true })).toBeVisible();
    await left.locator(".file-browser-pane-badge").click();
    await expect(filter).toHaveCount(0);
    await expect(left.locator(".file-browser-active-filter")).toContainText("no-such-file");
    await left.getByRole("button", { name: "清除名称过滤", exact: true }).click();
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list).toBeFocused();
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("独立入口用真实目录快照浏览、预览和返回，不启动数据库应用或覆盖原设置", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem("nr:local-file-browser", "original-nine-rings-state"));
  await page.goto("/file-workbench.html");
  await expect(page).toHaveTitle("File Workbench");
  await expect(page.getByText("FILE WORKBENCH", { exact: true })).toHaveCount(0);
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  for (const label of ["复制到另一栏", "移动到另一栏", "新建文件", "新建文件夹", "移入系统回收站"])
    await expect(browser.getByRole("button", { name: label, exact: true })).toBeDisabled();
  await left.getByRole("button", { name: "收藏当前目录", exact: true }).click();
  await left.getByRole("option", { name: /alpha.c/ }).dblclick();
  const preview = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await expect(preview).toContainText("int alpha(void)");
  await expect(browser).toBeHidden();
  await preview.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await expect(browser).toBeVisible();
  await expect(left.getByRole("option", { name: /alpha.c/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "配色", exact: true }).click();
  await page.getByRole("menuitem", { name: "柔和深色", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("file-workbench:nr:local-file-browser"))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("nr:local-file-browser"))).toBe("original-nine-rings-state");
  expect(await page.evaluate(() => localStorage.getItem("nr:file-browser-favorites"))).toBeNull();
  expect(scripts.some(url => /\/src\/(App|main)\.tsx(?:\?|$)/.test(url))).toBe(false);
  expect((await page.evaluate(() => indexedDB.databases())).map(db => db.name)).not.toContain("nine_rings");
});

test("独立入口复用目录正文搜索与比较，搜索结果可打开并返回", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  const root = await left.getByRole("combobox", { name: "选择授权目录", exact: true }).inputValue();
  const right = browser.getByRole("region", { name: "右侧目录", exact: true });
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption(root);
  await browser.getByRole("button", { name: "比较目录", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "目录比较", exact: true });
  await expect(compare).toContainText("alpha.c");
  await compare.getByRole("button", { name: "关闭目录比较", exact: true }).click();
  await browser.getByRole("button", { name: "搜索正文", exact: true }).click();
  const search = page.getByRole("dialog", { name: "目录搜索", exact: true });
  await search.getByRole("textbox", { name: "搜索本地文件正文", exact: true }).fill("search target");
  await search.getByRole("button", { name: "开始全文搜索", exact: true }).click();
  const hit = search.getByRole("button", { name: /guide.md/ });
  await expect(hit).toBeVisible(); await hit.click();
  const preview = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await expect(preview).toContainText("Shared browser search target.");
  await preview.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
});


test("共享源码编辑器保留原文、撤销和持久草稿，快照只能导出副本", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await left.getByRole("option", { name: /alpha.c/ }).dblclick();
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await expect(view.locator(".cm-content")).toContainText("int alpha(void)");
  await view.getByRole("button", { name: "允许编辑", exact: true }).click();
  const content = view.locator(".cm-content");
  await content.click(); await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("int edited(void) { return 7; }\n");
  await page.keyboard.press("ControlOrMeta+Z"); await expect(content).toContainText("alpha");
  await page.keyboard.press("ControlOrMeta+Shift+Z"); await expect(content).toContainText("edited");
  await expect(view.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
  const downloadEvent = page.waitForEvent("download");
  await view.getByRole("button", { name: "导出副本", exact: true }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, "utf8")).toBe("int edited(void) { return 7; }\n");
  await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "未保存的文件编辑", exact: true });
  await leave.getByRole("button", { name: "取消", exact: true }).click();
  await expect(content).toContainText("edited");
  await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await leave.getByRole("button", { name: "保留草稿后继续", exact: true }).click();
  await expect(browser).toBeVisible();
  await left.getByRole("option", { name: /alpha.c/ }).dblclick();
  await view.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(view.locator(".cm-content")).toContainText("edited");
  await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  await leave.getByRole("button", { name: "保留草稿后继续", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "恢复草稿（1）", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "恢复草稿", exact: true });
  await expect(recovery).toContainText("int edited(void)");
  await recovery.getByRole("button", { name: "删除草稿", exact: true }).click();
  await recovery.getByRole("button", { name: "取消", exact: true }).click();
  await expect(recovery).toContainText("int edited(void)");
  await recovery.getByRole("button", { name: "删除草稿", exact: true }).click();
  await recovery.getByRole("button", { name: "确认删除草稿", exact: true }).click();
  await expect(recovery).toContainText("没有未保存草稿");
  const databases = await page.evaluate(() => indexedDB.databases());
  expect(databases.map(db => db.name)).toContain("file-workbench-local-recovery");
  expect(databases.map(db => db.name)).not.toContain("nine-rings-local-file-recovery");
  expect(databases.map(db => db.name)).not.toContain("nine_rings");
});

test("授权文件用共享修订协议保存；外部变化拒绝覆盖并保留当前编辑", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { source: "int original;\n", modified: 1, writes: 0 };
    (window as any).__workbenchFile = state;
    const file = { kind: "file", name: "sample.c", getFile: async () => new File([state.source], "sample.c", { lastModified: state.modified }),
      createWritable: async () => {
        let pending = state.source;
        return { write: async (text: string) => { pending = text; }, close: async () => { state.source = pending; state.modified++; state.writes++; }, abort: async () => {} };
      },
    };
    (window as any).showDirectoryPicker = async () => ({ kind: "directory", name: "Granted", values: async function* () { yield file; }, getFileHandle: async () => file, queryPermission: async () => "granted" });
  });
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("button", { name: "添加授权目录", exact: true }).click();
  await browser.getByRole("option", { name: /sample.c/ }).dblclick();
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await view.getByRole("button", { name: "允许编辑", exact: true }).click();
  const content = view.locator(".cm-content");
  await content.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("int saved;\n");
  await page.keyboard.press("ControlOrMeta+S");
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchFile.source)).toBe("int saved;\n");
  await expect(view.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
  await content.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("int unsaved;\n");
  await page.evaluate(() => { (window as any).__workbenchFile.source = "int external;\n"; (window as any).__workbenchFile.modified++; });
  await page.keyboard.press("ControlOrMeta+S");
  const conflict = page.getByRole("dialog", { name: "磁盘版本比较", exact: true });
  await expect(conflict).toContainText("unsaved"); await expect(conflict).toContainText("external");
  expect(await page.evaluate(() => (window as any).__workbenchFile.writes)).toBe(1);
  expect(await page.evaluate(() => (window as any).__workbenchFile.source)).toBe("int external;\n");
});


test("草稿事务失败时不能离开编辑器，保留选区、文本和撤销历史", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  await browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /alpha.c/ }).dblclick();
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await view.getByRole("button", { name: "允许编辑", exact: true }).click();
  const content = view.locator(".cm-content");
  await expect(content).toBeEditable();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      const transaction = original.apply(this, args as any);
      if (this.name === "file-workbench-local-recovery" && args[1] === "readwrite") queueMicrotask(() => transaction.abort());
      return transaction;
    } as any;
  });
  await content.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("int precious;\n");
  await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "未保存的文件编辑", exact: true });
  await leave.getByRole("button", { name: "保留草稿后继续", exact: true }).click();
  await expect(leave.getByRole("alert")).toContainText(/取消|Abort|事务/);
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "取消", exact: true }).click();
  await expect(content).toContainText("precious");
  await content.click(); await page.keyboard.press("ControlOrMeta+Z");
  await expect(content).toContainText("alpha");
});


test("全文源码查看不再截断快速预览范围，只读也能定位到末尾", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  await browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /large.txt/ }).dblclick();
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  const content = view.locator(".cm-content");
  await expect(content).toContainText("Text source line.");
  await expect(content).toHaveAttribute("contenteditable", "false");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(content).toContainText("END-LARGE-SOURCE");
});

// Exercises the real Tauri JS bridge and source leave UI; OS window delivery
// and native dialogs still require the separate packaged-app acceptance check.
test("桌面关闭桥接等待保存决定，取消或草稿失败不退出，保存后才确认原生退出", async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    let next = 1, closeHandler = 0, viewHandler = 0;
    const state = { source: "int original;\n", revision: "r1", confirmed: 0, ready: false, copies: 0, tools: [] as any[], external: [] as Array<{ rootId: string; node: string; chooseApplication: boolean }> };
    const w = window as any;
    w.__workbenchNative = state;
    w.__workbenchNativeToggleHidden = () => callbacks.get(viewHandler)?.({ event: "workbench:toggle-hidden", id: viewHandler, payload: null });
    w.__workbenchNativeClose = () => callbacks.get(closeHandler)?.({ event: "workbench:request-close", id: closeHandler, payload: null });
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      transformCallback(callback: (event: unknown) => void) { const id = next++; callbacks.set(id, callback); return id; },
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") { if (args.event === "workbench:request-close") closeHandler = args.handler; if (args.event === "workbench:toggle-hidden") viewHandler = args.handler; return args.handler; }
        if (command === "plugin:event|unlisten") return;
        if (command === "workbench_set_view_menu") { (state as any).viewMenu = args; return; }
        if (command === "workbench_ready") { state.ready = true; return; }
        if (command === "workbench_confirm_close") { state.confirmed++; return; }
        if (command === "local_files_roots") return [{ id: "native-root", name: "Native" }];
        if (command === "local_files_display_path") return "/test/" + args.node;
        if (command === "local_files_list") return { nodes: [{ id: "sample.c", name: "sample.c", directory: false, size: 14, modifiedMs: 1 }], next: null };
        const snapshot = () => ({ source: state.source, revision: state.revision, bom: false, lineEnding: "lf", size: state.source.length, modifiedMs: 1 });
        if (command === "local_files_read") return snapshot();
        if (command === "local_files_write") { if (args.expectedRevision !== state.revision) throw new Error("STALE_REVISION"); state.source = args.source; state.revision = "r2"; return snapshot(); }
        if (command === "local_files_open_external") { state.external.push(args); return !args.chooseApplication; }
        if (command === "local_files_save_as") { state.copies++; return false; }
        if (command === "workbench_run_tool") { if (args.operation === "prepare") return { program: args.command, arguments: args.arguments, directory: "/test" }; state.tools.push(args); return 1234; }
        throw new Error("Unexpected native command: " + command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.ready)).toBe(true);
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.viewMenu?.enabled)).toBe(true);
  await page.evaluate(() => (window as any).__workbenchNativeToggleHidden());
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.viewMenu?.showHidden)).toBe(true);
  await page.evaluate(() => (window as any).__workbenchNativeToggleHidden());
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.viewMenu?.showHidden)).toBe(false);
  const item = browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /sample.c/ });
  await item.click();
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  const toolDialog = page.getByRole("dialog", { name: "工具栏工具", exact: true });
  await toolDialog.getByRole("textbox", { name: "工具名称", exact: true }).fill("Test launcher");
  await toolDialog.getByRole("textbox", { name: "工具命令", exact: true }).fill("/Applications/My Tool.app");
  await toolDialog.getByRole("textbox", { name: "工具参数", exact: true }).fill("{file}");
  await toolDialog.getByRole("button", { name: "保存工具", exact: true }).click();
  await toolDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "Test launcher", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "使用配置参数运行", exact: true }).click();
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.tools)).toEqual([{ command: "/Applications/My Tool.app", arguments: ["{file}"], rootId: "native-root", node: "", selected: ["sample.c"], targetRootId: "native-root", targetNode: "", expectedPlan: { program: "/Applications/My Tool.app", arguments: ["{file}"], directory: "/test" } }]);
  await expect(page.getByRole("dialog", { name: "工具执行", exact: true }).getByRole("status")).toContainText("PID 1234");
  await page.getByRole("button", { name: "关闭工具执行", exact: true }).click();
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  const openWith = page.getByRole("menu", { name: "打开方式", exact: true });
  await page.keyboard.press("ArrowRight");
  await expect(openWith.getByRole("menuitem", { name: "内置编辑器", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(openWith).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "打开方式", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("menuitem", { name: "系统默认应用", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.external)).toEqual([{ rootId: "native-root", node: "sample.c", chooseApplication: false }]);
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  await page.getByRole("menuitem", { name: "其它应用程序…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.external.length)).toBe(2);
  await expect(browser).toBeVisible();
  await item.dblclick({ modifiers: ["ControlOrMeta"] });
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.viewMenu?.enabled)).toBe(false);
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await view.getByRole("button", { name: "允许编辑", exact: true }).click();
  const content = view.locator(".cm-content");
  await content.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("int native_edit;\n");
  await view.getByRole("button", { name: "导出副本", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.copies)).toBe(1);
  await expect(view.getByRole("button", { name: "保存文件", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).__workbenchNativeClose());
  const leave = page.getByRole("dialog", { name: "未保存的文件编辑", exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__workbenchNative.confirmed)).toBe(0);
  await expect(content).toContainText("native_edit");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreDraftWrites = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      const transaction = original.apply(this, args as any);
      if (this.name === "file-workbench-local-recovery" && args[1] === "readwrite") queueMicrotask(() => transaction.abort());
      return transaction;
    } as any;
  });
  await page.evaluate(() => (window as any).__workbenchNativeClose());
  await leave.getByRole("button", { name: "保留草稿后继续", exact: true }).click();
  await expect(leave.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__workbenchNative.confirmed)).toBe(0);
  await leave.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => (window as any).__restoreDraftWrites());
  await page.evaluate(() => (window as any).__workbenchNativeClose());
  await leave.getByRole("button", { name: "保存后继续", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.confirmed)).toBe(1);
  expect(await page.evaluate(() => (window as any).__workbenchNative.source)).toBe("int native_edit;\n");
});

test("文件与目录只显示适用的右键操作，Web 快照不显示系统打开和写入命令", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await left.getByRole("option", { name: /alpha.c/ }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件菜单", exact: true });
  await expect(menu.getByRole("separator")).toHaveCount(2);
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "复制到另一栏", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "快速预览", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await left.getByRole("option", { name: /^sub/ }).click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "快速预览", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "复制名称", exact: true })).toBeEnabled();
  await menu.getByRole("menuitem", { name: "属性", exact: true }).click();
  const properties = page.getByRole("dialog", { name: "属性", exact: true });
  await expect(properties.locator("dd").filter({ hasText: /^目录$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await left.getByRole("option", { name: /alpha.c/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "打开", exact: true }).click();
  await expect(page.getByRole("region", { name: "文件源码工作区", exact: true })).toContainText("int alpha(void)");
  await expect(menu).toHaveCount(0);
});


test("独立工作台使用图标工具栏、统一地址栏与列表前的标签，过滤向左展开且 Esc 清除", async ({ page }, testInfo) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const toolbar = browser.getByRole("toolbar", { name: "双栏文件操作", exact: true });
  await expect(browser.locator(".file-browser-heading")).toHaveCount(0);
  const tools = toolbar.getByRole("button");
  for (const button of await tools.all()) {
    expect((await button.textContent())?.trim()).toBe("");
    expect(await button.getAttribute("title")).toBeTruthy();
    await expect(button.locator("svg")).toHaveCount(1);
  }
  await expect(toolbar.getByRole("button", { name: "恢复草稿（0）", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "恢复草稿（0）", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "恢复草稿", exact: true });
  await expect(recovery).toContainText("没有未保存草稿"); await page.keyboard.press("Escape");
  await expect(recovery).toHaveCount(0);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.locator(".file-browser-breadcrumb")).toHaveCount(1);
  await expect(left.getByRole("textbox", { name: "根内相对路径", exact: true })).toHaveCount(0);
  const filter = left.getByRole("button", { name: "过滤名称", exact: true });
  const input = left.getByRole("searchbox", { name: "过滤文件名称", exact: true });
  await expect(input).toHaveCount(0);
  const alpha = left.getByRole("option", { name: /alpha.c/ });
  await alpha.click();
  await filter.click(); await expect(input).toBeFocused();
  await input.press("Escape"); await expect(alpha).toHaveAttribute("aria-selected", "true");
  await filter.click(); await expect(input).toBeFocused();
  const fieldBox = await input.boundingBox(), filterBox = await filter.boundingBox(), historyBox = await left.getByRole("button", { name: "路径历史", exact: true }).boundingBox();
  expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(filterBox!.x);
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(historyBox!.x);
  await input.fill("alpha");
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /large.txt/ })).toHaveCount(0);
  await input.press("Escape"); await expect(input).toHaveCount(0); await expect(filter).toBeFocused();
  await expect(left.getByRole("option", { name: /large.txt/ })).toBeVisible();
  await left.getByRole("option", { name: /sub/ }).dblclick();
  await expect(left.getByRole("option", { name: /guide.md/ })).toBeVisible();
  await left.getByRole("button", { name: "编辑路径", exact: true }).click();
  const path = left.getByRole("textbox", { name: "根内相对路径", exact: true });
  await expect(path).toBeFocused(); await expect(path).toHaveValue("sub");
  await path.fill("not-a-folder"); await path.press("Escape"); await expect(path).toHaveCount(0);
  await expect(left.getByRole("option", { name: /guide.md/ })).toBeVisible();
  await left.getByRole("button", { name: "编辑路径", exact: true }).click();
  await path.fill(""); await path.press("Enter");
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  await expect(path).toHaveCount(0);
  const pathBox = await left.locator(".file-browser-path").boundingBox(), tabsBox = await left.getByRole("tablist").boundingBox(), columnsBox = await left.locator(".file-browser-column-viewport").boundingBox(), listBox = await left.getByRole("listbox").boundingBox();
  expect(tabsBox!.y).toBeGreaterThanOrEqual(pathBox!.y + pathBox!.height);
  expect(tabsBox!.y + tabsBox!.height).toBeLessThanOrEqual(columnsBox!.y);
  expect(columnsBox!.y + columnsBox!.height).toBeLessThanOrEqual(listBox!.y);
  await page.screenshot({ path: testInfo.outputPath("compact-workbench.png") });
});


test("窄窗口的统一地址栏和向左过滤输入框保持在可视区", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  await left.getByRole("button", { name: "过滤名称", exact: true }).click();
  const input = left.getByRole("searchbox", { name: "过滤文件名称", exact: true });
  await expect(input).toBeFocused();
  const bounds = await input.boundingBox(), pane = await left.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(pane!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 320, height: 812 });
  await expect.poll(async () => (await input.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await input.fill("alpha"); await expect(left.getByRole("option", { name: /large.txt/ })).toHaveCount(0);
  await input.press("Escape"); await expect(left.getByRole("option", { name: /large.txt/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("compact-workbench-narrow.png") });
});


test("View 切换当前栏隐藏项，类型表头双向排序，工具栏首次悬停使用快速提示", async ({ page }) => {
  await page.goto("/file-workbench.html");
  // WebKit's directory upload omits dotfiles. Supply the missing fixture through
  // the same FileList input; the real snapshot provider and filtering still run.
  await page.getByLabel("选择目录快照", { exact: true }).evaluate(input => {
    input.addEventListener("change", () => {
      const element = input as HTMLInputElement, files = Array.from(element.files ?? []);
      if (!files.length || files.some(file => file.name === ".secret")) return;
      const hidden = new File(["hidden\n"], ".secret", { type: "text/plain" });
      Object.defineProperty(hidden, "webkitRelativePath", { value: `${files[0].webkitRelativePath.split("/")[0]}/.secret` });
      const transfer = new DataTransfer();
      for (const file of [...files, hidden]) transfer.items.add(file);
      element.files = transfer.files;
    }, { capture: true, once: true });
  });
  const viewMenu = page.getByRole("button", { name: "View", exact: true });
  await viewMenu.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "显示隐藏项（当前栏）", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "View", exact: true })).toHaveCount(0);
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toContainText("C 源码");
  await expect(left.getByRole("option", { name: /^sub/ })).toContainText("文件夹");
  await expect(browser.getByRole("combobox", { name: "文件排序", exact: true })).toHaveCount(0);
  await expect(browser.getByRole("checkbox", { name: "隐藏项", exact: true })).toHaveCount(0);
  const compare = browser.getByRole("button", { name: "比较目录", exact: true });
  await compare.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("比较两栏当前目录", { timeout: 1500 });
  expect(await compare.getAttribute("title")).toBeNull();
  await viewMenu.click(); await expect(tooltip).toHaveCount(0);
  const hidden = page.getByRole("menuitemcheckbox", { name: "显示隐藏项（当前栏）", exact: true });
  await expect(hidden).toHaveAttribute("aria-checked", "false"); await hidden.click();
  await expect(left.getByRole("option", { name: /\.secret/ })).toBeVisible();
  await viewMenu.click(); await expect(hidden).toHaveAttribute("aria-checked", "true"); await hidden.click();
  await expect(left.getByRole("option", { name: /\.secret/ })).toHaveCount(0);
  const type = left.getByRole("button", { name: "按类型排序", exact: true });
  await type.click(); await expect(type).toHaveText("类型 ↑");
  await expect.poll(() => left.getByRole("listbox", { name: "文件列表", exact: true }).getByRole("option").allTextContents()).toEqual([expect.stringContaining("sub"), expect.stringContaining("alpha.c"), expect.stringContaining("large.txt")]);
  await type.click(); await expect(type).toHaveText("类型 ↓");
  await expect.poll(() => left.getByRole("listbox", { name: "文件列表", exact: true }).getByRole("option").allTextContents()).toEqual([expect.stringContaining("sub"), expect.stringContaining("large.txt"), expect.stringContaining("alpha.c")]);
  const right = browser.getByRole("region", { name: "右侧目录", exact: true });
  const rootId = await left.getByRole("combobox", { name: "选择授权目录", exact: true }).inputValue();
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption(rootId);
  await right.getByRole("option", { name: /alpha.c/ }).click();
  await expect(browser).toHaveAttribute("data-active-pane", "1");
  await viewMenu.click(); await hidden.click();
  await expect(right.getByRole("option", { name: /\.secret/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /\.secret/ })).toHaveCount(0);
  await left.getByRole("option", { name: /alpha.c/ }).dblclick();
  const editor = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await expect(editor).toBeVisible();
  await viewMenu.click(); await expect(hidden).toBeDisabled(); await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "View", exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test("命令执行先预览，实时输出和结果可重新打开；竖线可编辑并排序", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let callback = 1;
    (window as any).__toolFinished = false;
    (window as any).__toolExecutions = 0;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return callback++; }, unregisterCallback() {},
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") return callback++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [];
        if (command === "workbench_run_tool") {
          if (args.operation === "prepare") return { program: args.command, arguments: args.arguments, directory: null };
          (window as any).__toolExecutions++;
          return { id: 1, pid: 12 };
        }
        if (command === "workbench_stop_tool") { (window as any).__toolFinished = true; return; }
        if (command === "workbench_tool_status") return { done: (window as any).__toolFinished, code: (window as any).__toolFinished ? 2 : null, stdout: "first line\nworking…", stderr: (window as any).__toolFinished ? "test diagnostic" : "", bytes: 32, truncated: false, error: null };
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  const config = page.getByRole("dialog", { name: "工具栏工具", exact: true });
  await config.getByLabel("工具名称", { exact: true }).fill("测试命令");
  await config.getByLabel("工具命令", { exact: true }).fill("utility");
  await config.getByLabel("工具参数", { exact: true }).fill("a b\n$(literal)");
  await config.getByLabel("工具执行方式", { exact: true }).selectOption("capture");
  await config.getByRole("button", { name: "保存工具", exact: true }).click();
  await config.getByRole("button", { name: "新建工具", exact: true }).click();
  await config.getByLabel("工具类型", { exact: true }).selectOption("separator");
  await expect(config.getByLabel("工具命令", { exact: true })).toHaveCount(0);
  await config.getByRole("button", { name: "保存工具", exact: true }).click();
  await config.getByRole("button", { name: "工具向左移动", exact: true }).click();
  await config.getByRole("button", { name: "关闭", exact: true }).click();
  const separator = page.getByRole("separator", { name: "分隔符", exact: true });
  await expect(separator).toBeVisible();
  await separator.click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑分隔符", exact: true }).click();
  await config.getByLabel("工具名称", { exact: true }).fill("工具分组");
  await config.getByRole("button", { name: "保存工具", exact: true }).click();
  await config.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("separator", { name: "工具分组", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试命令", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "使用配置参数运行", exact: true }).click();
  const execution = page.getByRole("dialog", { name: "工具执行", exact: true });
  await expect(execution).toContainText('"utility" "a b" "$(literal)"');
  expect(await page.evaluate(() => (window as any).__toolExecutions)).toBe(0);
  await execution.getByRole("button", { name: "执行", exact: true }).click();
  await execution.getByRole("button", { name: "查看详细输出", exact: true }).click();
  await expect(execution).toContainText("working…");
  await page.screenshot({ path: testInfo.outputPath("tool-execution.png") });
  await expect(execution.getByRole("status")).toContainText("正在执行");
  await page.keyboard.press("Escape");
  await expect(execution).toHaveCount(0);
  await page.getByRole("button", { name: "查看上次工具执行", exact: true }).click();
  await expect(execution).toContainText("working…");
  expect(await page.evaluate(() => (window as any).__toolExecutions)).toBe(1);
  await page.evaluate(() => { (window as any).__toolFinished = true; });
  await expect(execution.getByRole("status")).toContainText("退出码 2");
  await expect(execution).toContainText("test diagnostic");
  await expect(execution.getByRole("button", { name: "执行", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).__toolFinished = false; });
  await page.getByRole("button", { name: "测试命令", exact: true }).click();
  await expect(execution.getByRole("status")).toContainText("正在执行");
  await expect(execution.locator("pre").first()).toHaveText('"utility"');
  await execution.getByRole("button", { name: "终止当前进程", exact: true }).click();
  await expect(execution.getByRole("status")).toContainText("退出码 2");
  expect(await page.evaluate(() => (window as any).__toolExecutions)).toBe(2);
  await execution.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(execution).toHaveCount(0);
  await page.getByRole("button", { name: "添加工具", exact: true }).click();
  await config.getByRole("button", { name: "工具分组（分隔符）", exact: true }).click();
  await config.getByRole("button", { name: "删除工具", exact: true }).click();
  await config.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("separator", { name: "工具分组", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("separator", { name: "工具分组", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "测试命令", exact: true })).toBeVisible();
});

test("独立父子授权按身份撤销，失败可重试，父目录仍可访问子目录", async ({ page }) => {
  await page.addInitScript(() => {
    let callback = 1;
    const roots = [{ id: "parent", name: "Parent" }, { id: "child", name: "Sub" }];
    let fail = true;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return callback++; }, unregisterCallback() {},
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") return callback++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [...roots];
        if (command === "local_files_display_path") return args.rootId === "parent" ? "/Parent" : "/Parent/Sub";
        if (command === "local_files_list") return { nodes: args.rootId === "parent" && !args.node ? [{ id: "Sub", name: "Sub", directory: true, size: 0, modifiedMs: 1 }] : [{ id: args.node ? "Sub/leaf.c" : "leaf.c", name: "leaf.c", directory: false, size: 20, modifiedMs: 1 }], next: null };
        if (command === "local_files_remove") {
          if (fail) { fail = false; throw new Error("persistence unavailable"); }
          const at = roots.findIndex(root => root.id === args.rootId); if (at >= 0) roots.splice(at, 1);
          (window as any).__removedRoot = args.rootId; return;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true }), right = page.getByRole("region", { name: "右侧目录", exact: true });
  await left.getByRole("listbox", { name: "文件列表", exact: true }).getByRole("option", { name: /^Sub/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  await expect(left.getByRole("option", { name: /^leaf.c/ })).toBeVisible();
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption("child");
  await page.getByRole("button", { name: "管理授权目录", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理授权目录", exact: true });
  await expect(manager).toContainText("/Parent/Sub");
  const child = manager.locator("article").filter({ has: page.getByText("/Parent/Sub", { exact: true }) });
  await child.getByRole("button", { name: "撤销授权", exact: true }).click();
  await child.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__removedRoot)).toBeUndefined();
  await child.getByRole("button", { name: "撤销授权", exact: true }).click();
  await child.getByRole("button", { name: "确认撤销授权", exact: true }).click();
  await expect(manager.getByRole("alert")).toContainText("persistence unavailable");
  await expect(child).toBeVisible();
  await child.getByRole("button", { name: "确认撤销授权", exact: true }).click();
  await expect(child).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__removedRoot)).toBe("child");
  await page.keyboard.press("Escape");
  await expect(left.getByRole("option", { name: /^leaf.c/ })).toBeVisible();
  await expect(right.getByRole("combobox", { name: "选择授权目录", exact: true })).toHaveValue("parent");
  await right.getByRole("listbox", { name: "文件列表", exact: true }).getByRole("option", { name: /^Sub/ }).dblclick({ modifiers: ["ControlOrMeta"] });
  await expect(right.getByRole("option", { name: /^leaf.c/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("file-workbench:nr:local-file-browser"))).not.toContain('"rootId":"child"');
});

test("固定目录标签经提醒后可关闭最后一个，右键不选中文本", async ({ page }) => {
  await page.goto("/file-workbench.html");
  await page.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const tab = left.getByRole("tab").first();
  await tab.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await tab.click({ button: "right" });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.getByRole("menuitem", { name: "固定标签", exact: true }).click();
  await tab.dblclick();
  const confirmation = page.getByRole("dialog", { name: "关闭固定目录标签", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tab).toContainText("◆");
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "关闭标签", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认关闭", exact: true }).click();
  await expect(left.getByRole("tab")).toHaveCount(1);
  await expect(left.getByRole("tab")).toHaveText("目录");
  await expect(left.getByRole("combobox", { name: "选择授权目录", exact: true })).toHaveValue("");
  await left.getByRole("button", { name: "恢复关闭的目录标签", exact: true }).click();
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
});

test("大量文件删除后刷新夹紧滚动，剩余条目完整显示并可继续键盘导航", async ({ page }) => {
  await page.addInitScript(() => {
    let callback = 1;
    const state = { names: Array.from({ length: 205 }, (_, n) => `${String(n).padStart(3, "0")}.txt`) };
    (window as any).__largeDeletion = state;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return callback++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return callback++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "large", name: "Large" }];
        if (command === "local_files_display_path") return "/large";
        if (command === "local_files_stat") return { size: 1, modifiedMs: 1 };
        if (command === "local_files_list") { const offset = args.offset ?? 0; return { nodes: state.names.slice(offset, offset + 200).map(name => ({ id: name, name, directory: false, size: 1, modifiedMs: 1 })), next: offset + 200 < state.names.length ? offset + 200 : null }; }
        if (command === "local_files_trash") { state.names = state.names.filter(name => name !== args.node); return; }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const list = left.getByRole("listbox", { name: "文件列表", exact: true });
  await expect(left.locator(".file-browser-pane-status")).toContainText("200 项");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(left.locator(".file-browser-pane-status")).toContainText("205 项");
  await list.focus(); await list.press("Home");
  for (let n = 0; n < 5; n++) await list.press("ArrowDown");
  await list.press("Shift+End");
  await expect(left.locator(".file-browser-pane-status")).toContainText("选中 200 项");
  await page.getByRole("button", { name: "移入系统回收站", exact: true }).click();
  await page.getByRole("dialog", { name: "移入系统回收站", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  // Each of 200 confirmed items persists queue progress; wait for the durable batch, not a single UI update.
  await expect.poll(() => page.evaluate(() => (window as any).__largeDeletion.names.length), { timeout: 20000 }).toBe(5);
  await queue.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("5 项");
  await expect(list.getByRole("option")).toHaveCount(5);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
  await list.focus(); await list.press("End");
  await expect(list.getByRole("option", { name: /^004.txt/ })).toHaveAttribute("aria-selected", "true");
  // A manual refresh takes the same full-reload path after external deletion.
  await page.evaluate(() => { (window as any).__largeDeletion.names = Array.from({ length: 205 }, (_, n) => `${String(n).padStart(3, "0")}.txt`); });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("200 项");
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(left.locator(".file-browser-pane-status")).toContainText("205 项");
  await list.focus(); await list.press("End");
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(1000);
  await page.evaluate(() => { (window as any).__largeDeletion.names = (window as any).__largeDeletion.names.slice(0, 5); });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("5 项");
  await expect(list.getByRole("option")).toHaveCount(5);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:nr:local-file-browser")!).groups[0].tabs[0].history.at(-1).scrollTop)).toBe(0);
  await page.evaluate(() => { (window as any).__largeDeletion.names = []; });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(list.getByText("空目录", { exact: true })).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(0);
});

test("固定目录标签保持名称，显式返回、子树限制和切换自动返回可独立配置", async ({ page }, testInfo) => {
  const root = testInfo.outputPath("anchor-fixture");
  await mkdir(join(root, "base", "deep"), { recursive: true });
  await writeFile(join(root, "root.txt"), "root");
  await writeFile(join(root, "base", "base.txt"), "base");
  await writeFile(join(root, "base", "deep", "deep.txt"), "deep");
  await page.goto("/file-workbench.html");
  await page.getByLabel("选择目录快照", { exact: true }).setInputFiles(root);
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const list = left.getByRole("listbox", { name: "文件列表", exact: true });
  await list.getByRole("option", { name: /^base/ }).dblclick();
  const tab = left.getByRole("tab", { name: "base", exact: true });
  await tab.click({ button: "right" }); await page.getByRole("menuitem", { name: "固定标签", exact: true }).click();
  await left.getByRole("button", { name: "上级目录", exact: true }).click();
  await expect(list.getByRole("option", { name: /^root.txt/ })).toBeVisible();
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("title", /固定目录：.*\/base\n当前位置：/);
  await left.getByRole("button", { name: "返回固定目录", exact: true }).click();
  await list.getByRole("option", { name: /^deep/ }).dblclick();
  await expect(list.getByRole("option", { name: /^deep.txt/ })).toBeVisible();
  await expect(tab).toBeVisible();
  await list.focus(); await list.press("Alt+Home");
  await expect(list.getByRole("option", { name: /^base.txt/ })).toBeVisible();
  await tab.click({ button: "right" }); await page.getByRole("menuitemcheckbox", { name: "限制在固定目录内", exact: true }).click();
  await left.getByRole("button", { name: "上级目录", exact: true }).click();
  await expect(left.getByRole("status")).toContainText("限制在固定目录内");
  await expect(list.getByRole("option", { name: /^base.txt/ })).toBeVisible();
  await tab.click({ button: "right" });
  await expect(page.getByRole("menuitemcheckbox", { name: "限制在固定目录内", exact: true })).toBeChecked();
  await page.getByRole("menuitemcheckbox", { name: "限制在固定目录内", exact: true }).click();
  await tab.click({ button: "right" }); await page.getByRole("menuitemcheckbox", { name: "切换到此标签时返回固定目录", exact: true }).click();
  await list.getByRole("option", { name: /^deep/ }).dblclick();
  await left.getByRole("button", { name: "新建目录标签", exact: true }).click();
  await tab.click();
  await expect(list.getByRole("option", { name: /^base.txt/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:nr:local-file-browser") || "null")?.groups[0]?.tabs[0]?.anchor?.node)).toBe("base");
});

test("不支持预览时显示文件详情而非错误，右键属性可查看快照元数据", async ({ page }) => {
  const fixture = await mkdtemp(join(tmpdir(), "nr-unsupported-preview-"));
  try {
    await writeFile(join(fixture, "archive.bin"), Buffer.from([0, 255, 0, 17]));
    await page.goto("/file-workbench.html");
    const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
    await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(fixture);
    const file = browser.getByRole("option", { name: /^archive.bin/ });
    await file.click({ button: "right" });
    await page.getByRole("menuitem", { name: "属性", exact: true }).click();
    const properties = page.getByRole("dialog", { name: "属性", exact: true });
    await expect(properties).toContainText("archive.bin");
    await expect(properties).toContainText("4 bytes");
    await page.keyboard.press("Escape");
    await file.click(); await page.keyboard.press("Space");
    const quick = page.getByRole("region", { name: "快速预览", exact: true });
    await expect(quick).toContainText("此文件暂时无法内置预览");
    await expect(quick.locator(".file-browser-file-details")).toContainText("4 bytes");
    await expect(quick.getByRole("alert")).toHaveCount(0);
    await quick.getByRole("button", { name: "关闭快速预览", exact: true }).click();
    await file.dblclick();
    const full = page.getByRole("region", { name: "文件源码工作区", exact: true });
    await expect(full).toContainText("此文件暂时无法内置预览");
    await expect(full.locator(".file-browser-file-details")).toContainText("archive.bin");
    await expect(full.getByRole("alert")).toHaveCount(0);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("大图片开始分段读取后可中断，迟到结果不显示；系统属性优先，拒绝后回退", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 1;
    const state = { reads: 0, propertyRequests: [] as boolean[], system: true };
    (window as any).__imageTest = state;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "images", name: "Images" }];
        if (command === "local_files_display_path") return "/images";
        if (command === "local_files_list") return { nodes: [{ id: "huge.png", name: "huge.png", size: 100 * 1024 * 1024, directory: false, modifiedMs: 10 }], next: null };
        if (command === "local_files_stat") return { size: 100 * 1024 * 1024, modifiedMs: 10 };
        if (command === "local_files_properties") { state.propertyRequests.push(args.system); return { path: "/images/huge.png", size: 100 * 1024 * 1024, modifiedMs: 10, createdMs: 5, accessedMs: 20, permissions: "644", systemShown: args.system && state.system }; }
        if (command === "local_files_read_asset") { state.reads++; return new Promise(resolve => { (window as any).__releaseImage = () => resolve(new Uint8Array(args.length).buffer); }); }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const file = page.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /^huge.png/ });
  await file.click({ button: "right" });
  await page.getByRole("menuitem", { name: "属性", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__imageTest.propertyRequests)).toEqual([true]);
  await expect(page.getByRole("dialog", { name: "属性", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__imageTest.system = false; });
  await file.click({ button: "right" });
  await page.getByRole("menuitem", { name: "属性", exact: true }).click();
  const properties = page.getByRole("dialog", { name: "属性", exact: true });
  await expect(properties).toContainText("/images/huge.png");
  await expect(properties).toContainText("644");
  await page.keyboard.press("Escape");
  await file.dblclick({ modifiers: ["ControlOrMeta"] });
  const preview = page.getByRole("region", { name: "快速预览", exact: true });
  await expect.poll(() => page.evaluate(() => (window as any).__imageTest.reads)).toBe(1);
  await preview.getByRole("button", { name: "中断加载", exact: true }).click();
  await expect(preview).toContainText("已中断预览加载");
  await expect(preview.locator(".file-browser-file-details")).toContainText("100.00 MiB");
  await page.evaluate(() => (window as any).__releaseImage());
  await expect(preview.getByRole("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__imageTest.reads)).toBe(1);
});

test("独立桌面入口跨栏拖放先确认再复制，多选及Shift移动目录保留目标身份", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 1;
    const files: Record<string, Record<string, boolean>> = { source: { "a.txt": false, "b.txt": false, folder: true, "folder/child.txt": false }, target: { nested: true } };
    const state = { files, writes: [] as any[] };
    (window as any).__dragFiles = state;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "source", name: "Source" }, { id: "target", name: "Target" }];
        if (command === "local_files_display_path") return `/${args.rootId}/${args.node ?? ""}`;
        if (command === "local_files_stat") return { size: 9, modifiedMs: 1 };
        if (command === "local_files_list") {
          const prefix = args.node ? args.node + "/" : "";
          return { nodes: Object.entries(files[args.rootId]).filter(([path]) => path.startsWith(prefix) && path !== args.node && !path.slice(prefix.length).includes("/")).map(([path, directory]) => ({ id: path, name: path.split("/").pop(), directory, size: 9, modifiedMs: 1 })), next: null };
        }
        if (command === "local_files_transfer") {
          const destination = [args.parent, args.name].filter(Boolean).join("/");
          if (destination in files[args.targetRootId]) throw new Error("TARGET_EXISTS");
          state.writes.push(args);
          for (const [path, directory] of Object.entries(files[args.rootId])) if (path === args.node || path.startsWith(args.node + "/")) {
            files[args.targetRootId][destination + path.slice(args.node.length)] = directory;
            if (args.moving) delete files[args.rootId][path];
          }
          return destination;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const right = page.getByRole("region", { name: "右侧目录", exact: true });
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption("target");
  const a = left.getByRole("option", { name: /^a.txt/ });
  await a.click();
  await left.getByRole("option", { name: /^b.txt/ }).click({ modifiers: ["ControlOrMeta"] });
  await a.dragTo(right.getByRole("listbox", { name: "文件列表", exact: true }), { targetPosition: { x: 150, y: 160 } });
  let dialog = page.getByRole("dialog", { name: "复制到另一栏", exact: true });
  await expect(dialog).toContainText("Target");
  await expect(dialog).toContainText("2 项");
  expect(await page.evaluate(() => (window as any).__dragFiles.writes)).toEqual([]);
  await dialog.getByRole("button", { name: "关闭文件操作", exact: true }).click();
  // Cancellation does not write; the same selection can be dragged again.
  await a.dragTo(right.getByRole("listbox", { name: "文件列表", exact: true }), { targetPosition: { x: 150, y: 160 } });
  dialog = page.getByRole("dialog", { name: "复制到另一栏", exact: true });
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__dragFiles.writes.length)).toBe(2);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await expect(right.getByRole("option", { name: /^a.txt/ })).toBeVisible();
  await expect(a).toBeVisible();
  // Dropping a folder on a folder row selects that directory, not the active pane.
  const folder = left.getByRole("option", { name: /^folder/ });
  const nested = right.getByRole("option", { name: /^nested/ });
  await folder.click();
  const source = (await folder.boundingBox())!, target = (await nested.boundingBox())!;
  await page.mouse.move(source.x + 40, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 70, source.y + source.height / 2, { steps: 3 });
  await page.keyboard.down("Shift");
  await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 8 });
  await page.mouse.move(target.x + 62, target.y + target.height / 2);
  await page.mouse.up(); await page.keyboard.up("Shift");
  dialog = page.getByRole("dialog", { name: "移动到另一栏", exact: true });
  await expect(dialog).toContainText("nested");
  expect(await page.evaluate(() => (window as any).__dragFiles.writes.length)).toBe(2);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__dragFiles.writes.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => "folder" in (window as any).__dragFiles.files.source)).toBe(false);
  expect(await page.evaluate(() => "nested/folder/child.txt" in (window as any).__dragFiles.files.target)).toBe(true);
});

test("桌面文件双击使用系统默认应用，本机主修饰键双击使用内置查看，Mac保留Control右键", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 1;
    (window as any).__systemOpen = [];
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "root", name: "Root" }];
        if (command === "local_files_display_path") return "/fixture/" + (args.node ?? "");
        if (command === "local_files_list") return { nodes: args.node ? [] : [{ id: "a.txt", name: "a.txt", directory: false, size: 4, modifiedMs: 1 }, { id: "sub", name: "sub", directory: true, size: 0 }], next: null };
        if (command === "local_files_stat") return { size: 4, modifiedMs: 1 };
        if (command === "local_files_read") return { source: "text", size: 4, modifiedMs: 1, revision: "r", bom: false, lineEnding: "lf" };
        if (command === "local_files_open_external") { (window as any).__systemOpen.push(args); return true; }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const file = left.getByRole("option", { name: /^a.txt/ });
  await file.dblclick();
  await expect.poll(() => page.evaluate(() => (window as any).__systemOpen)).toEqual([{ rootId: "root", node: "a.txt", chooseApplication: false }]);
  const view = page.getByRole("region", { name: "文件源码工作区", exact: true });
  await expect(view).toHaveCount(0);
  for (const modifier of ["ControlOrMeta"] as const) {
    await file.dblclick({ modifiers: [modifier] });
    await expect(view.locator(".cm-content")).toHaveText("text");
    await view.getByRole("button", { name: "返回文件浏览", exact: true }).click();
  }
  expect(await page.evaluate(() => (window as any).__systemOpen.length)).toBe(1);
  if (await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))) {
    await file.click({ modifiers: ["Control"] });
    await expect(page.getByRole("menu", { name: "文件菜单", exact: true })).toBeVisible();
    await expect(view).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await left.getByRole("option", { name: /^sub/ }).dblclick();
  await expect(left.getByRole("button", { name: "上级目录", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__systemOpen.length)).toBe(1);
});

test("文件拖到工具后冻结来源多选并预览命令，确认前不执行且拒绝伪造拖放", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("file-workbench:custom-tools-v1", JSON.stringify([{ id: "edit", name: "外部编辑", command: "editor", arguments: "--new-window", hint: "打开文件", icon: { kind: "preset", value: "code" } }]));
    let id = 1;
    const state = { plans: [] as any[], runs: [] as any[] };
    (window as any).__toolDrop = state;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "source", name: "Source" }];
        if (command === "local_files_display_path") return "/source";
        if (command === "local_files_stat") return { size: 4, modifiedMs: 1 };
        if (command === "local_files_list") return { nodes: ["a.txt", "b.txt"].map(name => ({ id: name, name, directory: false, size: 4, modifiedMs: 1 })), next: null };
        if (command === "workbench_run_tool") {
          if (args.operation === "prepare") { state.plans.push(args); return { program: args.command, arguments: ["--new-window", ...args.selected.map((node: string) => "/source/" + node)], directory: "/source" }; }
          state.runs.push(args); return 123;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const a = left.getByRole("option", { name: /^a.txt/ });
  await a.click(); await left.getByRole("option", { name: /^b.txt/ }).click({ modifiers: ["ControlOrMeta"] });
  const tool = page.getByRole("button", { name: "外部编辑", exact: true });
  await a.dragTo(tool);
  const dialog = page.getByRole("dialog", { name: "工具执行", exact: true });
  await expect(dialog).toContainText('"/source/a.txt" "/source/b.txt"');
  expect(await page.evaluate(() => (window as any).__toolDrop.runs)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__toolDrop.plans[0].arguments)).toEqual(["--new-window", "{files}"]);
  await dialog.getByRole("button", { name: "执行", exact: true }).click();
  await expect(dialog).toContainText("PID 123");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const forged = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData("application/x-nine-rings-browser-files", "forged"); return data; });
  await tool.dispatchEvent("drop", { dataTransfer: forged }); await forged.dispose();
  expect(await page.evaluate(() => (window as any).__toolDrop.plans.length)).toBe(1);
});


test("工具单击无参数直接启动，右键传文件并支持复制排列分隔和删除", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("file-workbench:custom-tools-v1", JSON.stringify([{ id: "edit", name: "外部编辑", command: "editor", arguments: "--new-window", hint: "打开文件", icon: { kind: "preset", value: "code" } }]));
    let id = 1;
    const state = { plans: [] as any[], runs: [] as any[] };
    (window as any).__toolDrop = state;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "source", name: "Source" }];
        if (command === "local_files_display_path") return "/source";
        if (command === "local_files_stat") return { size: 4, modifiedMs: 1 };
        if (command === "local_files_list") return { nodes: ["a.txt", "b.txt"].map(name => ({ id: name, name, directory: false, size: 4, modifiedMs: 1 })), next: null };
        if (command === "workbench_run_tool") {
          if (args.operation === "prepare") { state.plans.push(args); return { program: args.command, arguments: args.arguments.flatMap((argument: string) => argument === "{files}" ? args.selected.map((node: string) => "/source/" + node) : [argument]), directory: "/source" }; }
          state.runs.push(args); return 123;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const tool = page.getByRole("button", { name: "外部编辑", exact: true });
  const dialog = page.getByRole("dialog", { name: "工具执行", exact: true });
  await tool.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "打开当前选中文件", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  if (await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) {
    await tool.click({ modifiers: ["Control"] });
    await expect(page.getByRole("menuitem", { name: "打开应用", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).__toolDrop.runs.length)).toBe(0);
  }
  await tool.click();
  await expect.poll(() => page.evaluate(() => (window as any).__toolDrop.runs.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__toolDrop.runs[0].arguments)).toEqual([]);
  await expect(dialog).toHaveCount(0);
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  await left.getByRole("option", { name: /^a.txt/ }).click();
  await left.getByRole("option", { name: /^b.txt/ }).click({ modifiers: ["ControlOrMeta"] });
  await tool.click();
  await expect.poll(() => page.evaluate(() => (window as any).__toolDrop.runs.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__toolDrop.runs[1].arguments)).toEqual([]);
  await tool.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开当前选中文件", exact: true }).click();
  await expect(dialog).toContainText('"--new-window" "/source/a.txt" "/source/b.txt"');
  expect(await page.evaluate(() => (window as any).__toolDrop.runs.length)).toBe(2);
  await dialog.getByRole("button", { name: "执行", exact: true }).click();
  await expect(dialog).toContainText("PID 123"); await page.keyboard.press("Escape");
  await tool.click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制工具", exact: true }).click();
  const copy = page.getByRole("button", { name: "外部编辑 副本", exact: true });
  await expect(copy).toBeVisible();
  await copy.click({ button: "right" });
  await page.getByRole("menuitem", { name: "向左移动", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:custom-tools-v1")!)[0].name)).toBe("外部编辑 副本");
  await tool.click({ button: "right" });
  await page.getByRole("menuitem", { name: "在此前插入分隔符", exact: true }).click();
  const separator = page.getByRole("separator", { name: "分隔符", exact: true });
  await separator.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "打开应用", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "删除分隔符", exact: true }).click();
  await expect(separator).toHaveCount(0);
  await copy.click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除此工具", exact: true }).click();
  await expect(copy).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:custom-tools-v1")!)[0].arguments)).toBe("--new-window");
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as any).__restoreToolStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function(key, value) { if (key === "file-workbench:custom-tools-v1") throw new Error("storage denied"); original.call(this, key, value); }; });
  await tool.click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除此工具", exact: true }).click();
  await expect(tool).toBeVisible();
  await expect(page.locator(".workbench-tool-notice")).toContainText("无法保存工具");
  await page.evaluate(() => (window as any).__restoreToolStorage());
});


for (const locale of ["en-US", "de-DE"]) test.describe(`日期列测量 ${locale}`, () => {
  test.use({ locale });
  test("修改时间按实际文本收紧，表头行对齐且手动宽度优先", async ({ page }) => {
    await page.goto("/file-workbench.html");
    await page.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
    const left = page.getByRole("region", { name: "左侧目录", exact: true });
    const row = left.getByRole("option", { name: /alpha.c/ });
    await expect(row).toBeVisible();
    const geometry = () => row.evaluate(element => {
      const cell = element.lastElementChild!, header = element.closest(".file-browser-pane")!.querySelector(".file-browser-column:last-child")!;
      const range = document.createRange(); range.selectNodeContents(cell);
      return { gap: cell.getBoundingClientRect().width - range.getBoundingClientRect().width, header: header.getBoundingClientRect().left, body: cell.getBoundingClientRect().left };
    });
    await expect.poll(async () => (await geometry()).gap).toBeLessThan(11);
    expect((await geometry()).gap).toBeGreaterThanOrEqual(7);
    expect(Math.abs((await geometry()).header - (await geometry()).body)).toBeLessThan(1);
    await left.getByRole("button", { name: "按修改时间排序", exact: true }).click();
    await expect.poll(async () => (await geometry()).gap).toBeLessThan(11);
    const resize = left.getByRole("separator", { name: "调整修改时间列宽", exact: true });
    await resize.focus(); await resize.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:nr:file-browser-columns:0")!).autoModified)).toBe(false);
    const manual = Number(await resize.getAttribute("aria-valuenow"));
    await left.getByRole("button", { name: "按名称排序", exact: true }).click();
    await expect(resize).toHaveAttribute("aria-valuenow", String(manual));
    await resize.dblclick();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("file-workbench:nr:file-browser-columns:0")!).autoModified)).toBe(true);
    await expect.poll(async () => (await geometry()).gap).toBeLessThan(11);
  });
});

test("路径提示滚动时隐藏，停止后按光标下的新条目恢复并优先单行", async ({ page }) => {
  await page.addInitScript(() => {
    let id = 1;
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback() { return id++; }, unregisterCallback() {},
      async invoke(command: string) {
        if (command === "plugin:event|listen") return id++;
        if (["plugin:event|unlisten", "workbench_ready", "workbench_set_view_menu"].includes(command)) return;
        if (command === "local_files_roots") return [{ id: "source", name: "Source" }];
        if (command === "local_files_display_path") return "/authorized/Directory with spaces/Quite a long directory name";
        if (command === "local_files_stat") return { size: 4, modifiedMs: 1 };
        if (command === "local_files_list") return { nodes: Array.from({ length: 80 }, (_, n) => ({ id: `item_${String(n).padStart(3, "0")}_long_name.txt`, name: `item_${String(n).padStart(3, "0")}_long_name.txt`, directory: n === 0, size: 4, modifiedMs: 1 })), next: null };
        throw new Error(command);
      },
    };
  });
  await page.goto("/file-workbench.html");
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  const first = left.getByRole("option", { name: /^item_000/ });
  await expect(first).toHaveAttribute("data-tooltip-path", /authorized/);
  const box = (await first.boundingBox())!, x = box.x + 80, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  const hint = page.locator(".quick-tooltip-path");
  await expect(hint).toHaveText("/authorized/Directory with spaces/Quite a long directory name/item_000_long_name.txt");
  expect(await hint.evaluate(element => element.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(element).lineHeight) + 12)).toBe(true);
  const old = await hint.textContent();
  for (let n = 0; n < 3; n++) {
    await page.mouse.wheel(0, 96);
    await expect(hint).toHaveCount(0);
  }
  await expect.poll(() => left.getByRole("listbox").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const currentPath = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tooltip-path]")?.dataset.tooltipPath, { x, y });
  expect(currentPath).not.toBe(old);
  await expect(hint).toHaveText(currentPath!);
  await page.mouse.move(1, 1);
  await expect(hint).toHaveCount(0);
});

test("大量目录标签使用4px横向滚动条并保留触控板滚动", async ({ page }) => {
  await page.goto("/file-workbench.html");
  await page.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = page.getByRole("region", { name: "左侧目录", exact: true });
  for (let n = 0; n < 10; n++) await left.getByRole("button", { name: "新建目录标签", exact: true }).click();
  const tabs = left.getByRole("tablist", { name: "左栏目录标签", exact: true });
  await expect.poll(() => tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await tabs.evaluate(element => getComputedStyle(element, "::-webkit-scrollbar").height)).toBe("4px");
  expect(await tabs.evaluate(element => getComputedStyle(element).overflowY)).toBe("hidden");
  await tabs.evaluate(element => { element.scrollLeft = 0; });
  await tabs.hover(); await page.mouse.wheel(200, 0);
  await expect.poll(() => tabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});
