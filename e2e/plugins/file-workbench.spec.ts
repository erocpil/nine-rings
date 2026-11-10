import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nr-workbench-e2e-"));
  await mkdir(join(directory, "sub"));
  await writeFile(join(directory, "large.txt"), "Text source line.\n".repeat(70000) + "END-LARGE-SOURCE\n");
  await writeFile(join(directory, "alpha.c"), "int alpha(void) { return 42; }\n");
  await writeFile(join(directory, "sub", "guide.md"), "# Guide\n\nShared browser search target.\n");
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("独立入口用真实目录快照浏览、预览和返回，不启动数据库应用或覆盖原设置", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem("nr:local-file-browser", "original-nine-rings-state"));
  await page.goto("/file-workbench.html");
  await expect(page.getByText("FILE WORKBENCH", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "深色", exact: true }).click();
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
    let next = 1, closeHandler = 0;
    const state = { source: "int original;\n", revision: "r1", confirmed: 0, ready: false, copies: 0, external: [] as Array<{ rootId: string; node: string; chooseApplication: boolean }> };
    const w = window as any;
    w.__workbenchNative = state;
    w.__workbenchNativeClose = () => callbacks.get(closeHandler)?.({ event: "workbench:request-close", id: closeHandler, payload: null });
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      transformCallback(callback: (event: unknown) => void) { const id = next++; callbacks.set(id, callback); return id; },
      async invoke(command: string, args: any = {}) {
        if (command === "plugin:event|listen") { if (args.event === "workbench:request-close") closeHandler = args.handler; return args.handler; }
        if (command === "plugin:event|unlisten") return;
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
  const item = browser.getByRole("region", { name: "左侧目录", exact: true }).getByRole("option", { name: /sample.c/ });
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  await page.getByRole("menuitem", { name: "系统默认应用", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.external)).toEqual([{ rootId: "native-root", node: "sample.c", chooseApplication: false }]);
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  await page.getByRole("menuitem", { name: "其它应用程序…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__workbenchNative.external.length)).toBe(2);
  await expect(browser).toBeVisible();
  await item.dblclick();
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

test("文件右键菜单分组，打开方式支持键盘子菜单，Web 不伪造系统打开能力", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await left.getByRole("option", { name: /alpha.c/ }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件菜单", exact: true });
  await expect(menu.getByRole("separator")).toHaveCount(3);
  await menu.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  const submenu = page.getByRole("menu", { name: "打开方式", exact: true });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem", { name: /系统默认应用/ })).toBeDisabled();
  await expect(submenu.getByRole("menuitem", { name: /其它应用程序/ })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(submenu.getByRole("menuitem", { name: "内置编辑器", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(submenu).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "打开方式", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "文件源码工作区", exact: true })).toContainText("int alpha(void)");
  await expect(menu).toHaveCount(0);
});
