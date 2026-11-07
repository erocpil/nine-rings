import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";

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

test("双栏复制冲突改名并继续，保留源文件和已有目标，进度准确", async ({ page }) => {
  const { browser, left, right } = await setup(page);
  await left.getByRole("option", { name: /a.c/ }).click();
  await left.getByRole("option", { name: /b.c/ }).click({ modifiers: ["ControlOrMeta"] });
  await browser.getByRole("button", { name: "复制到另一栏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "复制到另一栏", exact: true });
  await expect(dialog).toContainText("目标：Right");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "同名冲突：a.c" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "冲突后的名称", exact: true }).fill("a-copy.c");
  await dialog.getByRole("button", { name: "按新名称重试", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("成功 2 项");
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
  const dialog = page.getByRole("dialog", { name: "移动到另一栏", exact: true });
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__browserOperations.finish))).toBe(true);
  await dialog.getByRole("button", { name: "停止后续项", exact: true }).click();
  await page.evaluate(() => (window as any).__browserOperations.finish());
  await expect(dialog.getByRole("status")).toContainText("已停止：成功 1 项");
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
  await expect(dialog.getByRole("status")).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await left.getByRole("option", { name: /new.c/ }).click();
  await browser.getByRole("button", { name: "重命名", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "重命名", exact: true });
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("renamed.c");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await left.getByRole("option", { name: /renamed.c/ }).click();
  await browser.getByRole("button", { name: "移入系统回收站", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移入系统回收站", exact: true });
  await expect(left.getByRole("option", { name: /renamed.c/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("成功 1 项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(left.getByRole("option", { name: /renamed.c/ })).toHaveCount(0);
});
