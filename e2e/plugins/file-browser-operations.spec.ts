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
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
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
