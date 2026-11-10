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
  const left = browser.getByRole("region", { name: "左侧目录", exact: true }), right = browser.getByRole("region", { name: "右侧目录", exact: true });
  // Rename is local to one pane and must work before the other pane is chosen.
  const menu = page.getByRole("menu", { name: "文件菜单", exact: true });
  await left.getByRole("option", { name: /^folder/ }).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByRole("dialog", { name: "重命名", exact: true }).getByRole("textbox", { name: "名称", exact: true }).fill("package");
  await page.getByRole("dialog", { name: "重命名", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__workbenchOps.tree["package/a.c"]))).toBe(true);
  await page.getByRole("button", { name: "收起操作队列", exact: true }).click();
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption("native-root");
  await right.getByRole("option", { name: /^target/ }).dblclick();
  await left.getByRole("option", { name: /^package/ }).click({ button: "right" });
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
  await right.getByRole("option", { name: /^renamed/ }).dblclick();
  await right.getByRole("option", { name: /^a.c/ }).dblclick();
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
    const state = { source: "int original;\n", revision: "r1", confirmed: 0, ready: false, copies: 0, external: [] as Array<{ rootId: string; node: string; chooseApplication: boolean }> };
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
  await item.dblclick();
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
  await expect(menu.getByRole("separator")).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "复制到另一栏", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "快速预览", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await left.getByRole("option", { name: /^sub/ }).click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "快速预览", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "复制名称", exact: true })).toBeEnabled();
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
