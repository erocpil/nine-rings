import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { sourceInfo, selectSource } from "../helpers/source-editor";

async function setup(page: Page) {
  await createBlankDocument(page, "双栏操作之前的文档");
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const nodes = new Map<string, Map<string, string>>([["left", new Map([["a.c", "A"], ["b.c", "B"]])], ["right", new Map([["a.c", "existing"]])]]);
    const fixture = { nodes, attempts: [] as string[], slow: false, finish: null as null | (() => void) };
    (window as any).__browserOperations = fixture;
    Object.assign(localFileService, {
      roots: async () => [{ id: "left", name: "Left" }, { id: "right", name: "Right" }],
      canTransfer: () => true, supportsDirectoryChanges: () => true, canTrash: () => true,
      list: async (root: string, parent: string) => ({ nodes: [...nodes.get(root)!.keys()].filter(id => id.split("/").slice(0, -1).join("/") === parent).map(id => ({ id, name: id.split("/").pop()!, directory: false, size: 1 })), next: null }),
      stat: async () => ({ size: 1, modifiedMs: 1 }),
      transfer: async (root: string, node: string, target: string, parent: string, name: string, moving: boolean) => {
        const destination = [parent, name].filter(Boolean).join("/");
        fixture.attempts.push(destination);
        if (nodes.get(target)!.has(destination)) throw new Error("TARGET_EXISTS: 目标名称已存在，未覆盖");
        if (fixture.slow) await new Promise<void>(resolve => { fixture.finish = resolve; });
        nodes.get(target)!.set(destination, nodes.get(root)!.get(node)!);
        if (moving) nodes.get(root)!.delete(node);
        return destination;
      },
      create: async (root: string, parent: string, name: string) => { const path = [parent, name].filter(Boolean).join("/"); nodes.get(root)!.set(path, ""); return path; },
      move: async (root: string, node: string, parent: string, name: string) => { const path = [parent, name].filter(Boolean).join("/"); nodes.get(root)!.set(path, nodes.get(root)!.get(node)!); nodes.get(root)!.delete(node); return path; },
      trash: async (root: string, node: string) => { nodes.get(root)!.delete(node); },
    });
    const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true); saveFileBrowserEnabled(true);
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  await page.getByRole("region", { name: "本地文件树", exact: true }).getByRole("button", { name: "双栏浏览", exact: true }).click();
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  const right = browser.getByRole("region", { name: "右侧目录", exact: true });
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption("right");
  await expect(right.getByRole("option", { name: /a.c/ })).toBeVisible();
  return { browser, left, right };
}

test("重新激活双栏后可核对历史结果，但不恢复或重试磁盘任务", async ({ page }) => {
  const { browser, left } = await setup(page);
  await left.getByRole("option", { name: /b.c/ }).click();
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("status")).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(async () => { const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts"); saveFileBrowserEnabled(false); });
  await expect(browser).toHaveCount(0);
  await page.evaluate(async () => { const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts"); saveFileBrowserEnabled(true); });
  await page.getByRole("navigation", { name: "工作区面板", exact: true }).getByRole("button", { name: "双栏浏览", exact: true }).click();
  await browser.getByRole("button", { name: "操作队列", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await dialog.locator(".file-browser-queue-history > summary").click();
  await dialog.locator(".file-browser-queue-history details > summary").click();
  await expect(dialog.locator(".file-browser-queue-history pre")).toContainText("成功 1");
  await expect(dialog.locator(".file-browser-queue-jobs")).toContainText("当前没有操作记录");
  await expect(dialog.getByRole("button", { name: /重试未完成项/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["b.c"]);
  await dialog.getByRole("button", { name: "清除历史记录", exact: true }).click();
  await expect(dialog.locator(".file-browser-queue-history pre")).toHaveCount(0);
});

test("双栏复制冲突改名并继续，保留源文件和已有目标，进度准确", async ({ page }) => {
  const { browser, left, right } = await setup(page);
  await left.getByRole("option", { name: /a.c/ }).click();
  await left.getByRole("option", { name: /b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "复制到另一栏", exact: true });
  await expect(dialog).toContainText("目标：Right");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("group", { name: "同名冲突：a.c" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "冲突后的名称", exact: true }).fill("a-copy.c");
  await dialog.getByRole("button", { name: "按新名称重试", exact: true }).click();
  await expect(dialog.getByRole("status").last()).toContainText("成功 2 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(right.getByRole("option", { name: /a-copy.c/ })).toBeVisible();
  await expect(right.getByRole("option", { name: /b.c/ })).toBeVisible();
  expect(await page.evaluate(() => [...(window as any).__browserOperations.nodes.get("left")])).toEqual([["a.c", "A"], ["b.c", "B"]]);
  expect(await page.evaluate(() => (window as any).__browserOperations.nodes.get("right").get("a.c"))).toBe("existing");
});

test("外部变化保留已加载范围、可见行和多选，删除后只清理已消失项", async ({ page }) => {
  await page.clock.install();
  const { browser, left } = await setup(page);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const fixture = (window as any).__browserOperations;
    fixture.nodes.set("left", new Map(Array.from({ length: 250 }, (_, index) => [`file-${String(index).padStart(3, "0")}.c`, "A"])));
    localFileService.list = async (root, _parent, offset = 0) => {
      const entries = [...fixture.nodes.get(root).keys()].sort().map((id: string) => ({ id, name: id, directory: false, size: fixture.nodes.get(root).get(id).length, modifiedMs: 1 }));
      return { nodes: entries.slice(offset, offset + 200), next: offset + 200 < entries.length ? offset + 200 : null };
    };
  });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("200 项");
  await left.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("250 项");
  const list = left.getByRole("listbox", { name: "文件列表" });
  await list.evaluate(element => { element.scrollTop = 1600; });
  await left.getByRole("option", { name: /file-055.c/ }).click();
  await left.getByRole("option", { name: /file-056.c/ }).click({ modifiers: ["ControlOrMeta"] });
  const anchor = await list.evaluate(element => {
    (window as any).__browserLoading = false;
    new MutationObserver(() => { if (element.getAttribute("aria-busy") === "true") (window as any).__browserLoading = true; }).observe(element, { attributes: true, attributeFilter: ["aria-busy"] });
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>("[data-node-id]")].find(row => row.getBoundingClientRect().top >= top)!;
    return { id: row.dataset.nodeId!, y: row.getBoundingClientRect().top };
  });
  await page.evaluate(() => {
    (window as any).__browserOperations.nodes.get("left").set("000-added.c", "external");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(left.locator(".file-browser-pane-status")).toContainText("251 项");
  await expect(left.locator('[aria-selected="true"][role="option"]')).toHaveCount(2);
  await expect.poll(async () => Math.abs((await left.locator(`[data-node-id="${anchor.id}"]`).boundingBox())!.y - anchor.y)).toBeLessThan(1);
  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(browser.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    const entries = (window as any).__browserOperations.nodes.get("left");
    entries.delete("file-055.c"); entries.set("file-056.c", "longer external content");
  });
  await page.clock.fastForward(5000);
  await expect(left.locator(".file-browser-pane-status")).toContainText("选中 1 项");
  await expect(left.getByRole("option", { name: /file-056.c/ })).toHaveAttribute("aria-selected", "true");
  await expect(left.getByRole("option", { name: /file-056.c/ })).toContainText("23 B");
  expect(await page.evaluate(() => (window as any).__browserLoading)).toBe(false);
});

test("菜单打开期间暂停检查，切换授权根拒绝迟到的目录结果", async ({ page }) => {
  const { left } = await setup(page);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const original = localFileService.list;
    (window as any).__browserRefresh = { calls: 0, delay: false, finish: null };
    localFileService.list = async (...args) => {
      const fixture = (window as any).__browserRefresh;
      if (args[0] !== "left") return original(...args);
      fixture.calls++;
      const value = await original(...args);
      if (fixture.delay) await new Promise<void>(resolve => { fixture.finish = resolve; });
      return value;
    };
  });
  await left.getByRole("option", { name: /a.c/ }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "文件菜单" })).toBeVisible();
  const before = await page.evaluate(() => (window as any).__browserRefresh.calls);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => (window as any).__browserRefresh.calls)).toBe(before);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).__browserRefresh.delay = true; window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserRefresh.finish))).toBe(true);
  await left.getByRole("combobox", { name: "选择授权目录" }).selectOption("right");
  await expect(left.getByRole("option", { name: /a.c/ })).toBeVisible();
  await page.evaluate(() => (window as any).__browserRefresh.finish());
  await expect(left.getByRole("option", { name: /b.c/ })).toHaveCount(0);
  await expect(left.getByRole("combobox", { name: "选择授权目录" })).toHaveValue("right");
});

test("停止双栏移动保留已完成项，不启动后续项", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.nodes.get("right").clear(); fixture.slow = true; });
  await left.getByRole("option", { name: /a.c/ }).click();
  await left.getByRole("option", { name: /b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "移动到另一栏", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "移动到另一栏", exact: true });
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await dialog.getByRole("button", { name: "停止后续项", exact: true }).click();
  await page.evaluate(() => (window as any).__browserOperations.finish());
  await expect(dialog.getByRole("status").last()).toContainText("已停止：成功 1 项");
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["a.c"]);
  expect(await page.evaluate(() => [...(window as any).__browserOperations.nodes.get("left").keys()])).toEqual(["b.c"]);
});

test("双栏新建、重命名和回收站确认后刷新列表", async ({ page }) => {
  const { browser, left } = await setup(page);
  await left.getByRole("listbox", { name: "文件列表" }).focus();
  await browser.getByRole("button", { name: "新建文件", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "新建文件", exact: true });
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("new.c");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("status").last()).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await left.getByRole("option", { name: /new.c/ }).click();
  await browser.getByRole("button", { name: "重命名", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "重命名", exact: true });
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("renamed.c");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("status").last()).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await left.getByRole("option", { name: /renamed.c/ }).click();
  await browser.getByRole("button", { name: "移入系统回收站", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移入系统回收站", exact: true });
  await expect(left.getByRole("option", { name: /renamed.c/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(dialog.getByRole("status").last()).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(left.getByRole("option", { name: /renamed.c/ })).toHaveCount(0);
});

test("收起队列后可继续添加任务，按确认顺序执行并保留结果", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.nodes.get("right").clear(); fixture.slow = true; });
  await left.getByRole("option", { name: /a.c/ }).click();
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(queue).toHaveCount(0);
  await left.getByRole("option", { name: /b.c/ }).click();
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  await expect(queue.getByRole("article", { name: "任务 2", exact: true })).toContainText("排队中");
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["a.c"]);
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.slow = false; fixture.finish(); });
  await expect(queue.getByRole("article", { name: "任务 2", exact: true }).getByRole("status")).toContainText("已完成：成功 1 项");
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["a.c", "b.c"]);
  await queue.getByRole("button", { name: "关闭", exact: true }).click();
  await browser.getByRole("button", { name: "操作队列", exact: true }).click();
  await expect(queue.getByRole("article")).toHaveCount(2);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { (window as any).__queueReport = text; } }); });
  await queue.getByRole("button", { name: "复制结果", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__queueReport)).toContain("#2 复制到另一栏");
  expect(await page.evaluate(() => (window as any).__queueReport)).toContain("Right");
  await page.screenshot({ path: "/tmp/nr-browser-queue-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await queue.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/nr-browser-queue-mobile.png" });
  await queue.getByRole("button", { name: "清除已结束", exact: true }).click();
  await expect(queue).toContainText("当前没有操作记录");
});

test("未知写入失败保留逐项结果，仅重试尚未执行的项", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    (window as any).__browserOperations.nodes.get("left").set("c.c", "C");
    const original = localFileService.transfer;
    localFileService.transfer = async (...args) => {
      if (args[1] === "b.c") { (window as any).__browserOperations.attempts.push("b.c"); throw new Error("disk full"); }
      return original(...args);
    };
    (window as any).__browserOperations.nodes.get("right").clear();
  });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(left.getByRole("option", { name: /c.c/ })).toBeVisible();
  await left.getByRole("option", { name: /a.c/ }).click();
  await left.getByRole("option", { name: /b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await left.getByRole("option", { name: /c.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(queue).toContainText("队列因失败暂停");
  await expect(queue.locator('[data-state="uncertain"]')).toContainText("b.c");
  await expect(queue).toContainText("disk full");
  await queue.getByRole("button", { name: "重试未完成项（1）", exact: true }).click();
  await queue.getByRole("button", { name: "继续排队任务", exact: true }).click();
  await expect(queue.getByRole("article", { name: "任务 2", exact: true }).getByRole("status")).toContainText("已完成：成功 1 项");
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["a.c", "b.c", "c.c"]);
});

test("跨磁盘目标已发布但来源未收尾时保留两端，排除重复移动", async ({ page }) => {
  const { browser, left, right } = await setup(page);
  await page.evaluate(async () => {
    const fixture = (window as any).__browserOperations; fixture.nodes.get("right").clear();
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const transfer = localFileService.transfer;
    localFileService.transfer = async (...args) => {
      if (args[1] === "a.c") {
        fixture.attempts.push("a.c"); fixture.nodes.get("right").set("a.c", fixture.nodes.get("left").get("a.c"));
        throw new Error("MOVE_COPY_PUBLISHED: 目标副本已发布；TARGET_EXISTS: 来源尚未确认移至系统回收站，请核对两处");
      }
      return transfer(...args);
    };
  });
  await left.getByRole("option", { name: /a.c/ }).click();
  await left.getByRole("option", { name: /b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "移动到另一栏", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "移动到另一栏", exact: true });
  await expect(confirm).toContainText("跨磁盘先复制并校验");
  await confirm.getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect(queue).toContainText("队列因失败暂停");
  await expect(queue.locator('[data-state="uncertain"]')).toContainText("a.c");
  await expect(queue.getByRole("group", { name: "同名冲突：a.c", exact: true })).toHaveCount(0);
  await queue.getByRole("button", { name: "重试未完成项（1）", exact: true }).click();
  await queue.getByRole("button", { name: "继续排队任务", exact: true }).click();
  await expect(queue.getByRole("article", { name: "任务 2", exact: true }).getByRole("status")).toContainText("已完成：成功 1 项");
  expect(await page.evaluate(() => (window as any).__browserOperations.attempts)).toEqual(["a.c", "b.c"]);
  expect(await page.evaluate(() => [...(window as any).__browserOperations.nodes.get("left")])).toEqual([["a.c", "A"]]);
  expect(await page.evaluate(() => [...(window as any).__browserOperations.nodes.get("right")])).toEqual([["a.c", "A"], ["b.c", "B"]]);
  await queue.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(left.getByRole("option", { name: /a.c/ })).toBeVisible();
  await expect(right.getByRole("option", { name: /a.c/ })).toBeVisible();
});

test("后台移动已打开来源时同步视图身份并保留光标，不重建旧路径缓存", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(async () => {
    const fixture = (window as any).__browserOperations; fixture.nodes.get("right").clear(); fixture.slow = true;
    fixture.nodes.get("left").set("a.c", "int alpha;\nint beta;\n");
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.readSnapshot = async (root, node) => ({ source: fixture.nodes.get(root).get(node), revision: "r1", size: 1, modifiedMs: 1, bom: false, lineEnding: "lf" });
  });
  await left.getByRole("option", { name: /a.c/ }).click();
  await browser.getByRole("button", { name: "移动到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "移动到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await queue.getByRole("button", { name: "收起", exact: true }).click();
  await left.getByRole("option", { name: /a.c/ }).dblclick();
  const area = page.locator(".local-file-view .cm-content");
  await expect(area).toContainText("int beta;");
  await selectSource(area, 14);
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.slow = false; fixture.finish(); });
  await expect.poll(() => page.evaluate(async () => (await import("/src/lib/plugin-system/main-view-registry.ts")).mainViews.getSnapshot().current?.data)).toMatchObject({ rootId: "right", nodeId: "a.c" });
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(14);
  await expect(area).toHaveAttribute("contenteditable", "true");
  expect(await page.evaluate(async () => (await import("/src/lib/local-files/session.ts")).localFileSessions.has("left:a.c"))).toBe(false);
});

test("后台处理来源文件时暂时只读，完成后恢复且不改变权限偏好", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(async () => {
    const fixture = (window as any).__browserOperations; fixture.nodes.get("right").clear(); fixture.slow = true;
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.readSnapshot = async () => ({ source: "int a;", revision: "r1", size: 6, modifiedMs: 1, bom: false, lineEnding: "lf" });
  });
  await left.getByRole("option", { name: /a.c/ }).click();
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await queue.getByRole("button", { name: "收起", exact: true }).click();
  await left.getByRole("option", { name: /a.c/ }).dblclick();
  const content = page.locator(".local-file-view .cm-content");
  await expect(content).toContainText("int a;");
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: "允许编辑", exact: true })).toBeDisabled();
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.slow = false; fixture.finish(); });
  await expect(content).toHaveAttribute("contenteditable", "true");
  expect(await page.evaluate(() => localStorage.getItem("nr:local-file-readonly-rules"))).toBeNull();
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await browser.getByRole("button", { name: "操作队列", exact: true }).click();
  await expect(queue.getByRole("status")).toContainText("已完成：成功 1 项");
});

test("Markdown 渲染视图不能把队列的临时只读写入权限偏好", async ({ page }) => {
  const { browser, left } = await setup(page);
  await page.evaluate(async () => {
    const fixture = (window as any).__browserOperations;
    fixture.nodes.get("left").set("note.md", "# 标题\n\n正文\n"); fixture.nodes.get("right").clear(); fixture.slow = true;
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    localFileService.readSnapshot = async () => ({ source: "# 标题\n\n正文\n", revision: "r1", size: 1, modifiedMs: 1, bom: false, lineEnding: "lf" });
  });
  await left.getByRole("button", { name: "刷新目录", exact: true }).click();
  await left.getByRole("option", { name: /note.md/ }).click();
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  await page.getByRole("dialog", { name: "复制到另一栏", exact: true }).getByRole("button", { name: "确认", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "文件操作队列", exact: true });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await queue.getByRole("button", { name: "收起", exact: true }).click();
  await left.getByRole("option", { name: /note.md/ }).dblclick();
  const workspace = page.getByRole("region", { name: "本地文件工作区", exact: true });
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(workspace.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "false");
  await expect(workspace.getByRole("button", { name: "点击设为可编辑", exact: true })).toHaveCount(0);
  await page.evaluate(() => { const fixture = (window as any).__browserOperations; fixture.slow = false; fixture.finish(); });
  await expect(workspace.locator(".ProseMirror:visible")).toHaveAttribute("contenteditable", "true");
  expect(await page.evaluate(() => localStorage.getItem("nr:local-file-readonly-rules"))).toBeNull();
});
