import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

test("本地目录创建、保存汇总、移动和 Worker 全文搜索跳转", async ({ page }) => {
  await createBlankDocument(page, "本地文件操作回归");
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
    const missing = () => new DOMException("missing", "NotFoundError");
    function directory(name: string, parent?: any): any {
      const children = new Map<string, any>();
      const handle: any = {
        name, kind: "directory", children,
        async *values() { yield* children.values(); },
        queryPermission: async () => "granted", requestPermission: async () => "granted",
        async getDirectoryHandle(key: string, options?: { create: boolean }) {
          if (!children.has(key) && options?.create) children.set(key, directory(key, handle));
          const result = children.get(key); if (result?.kind !== "directory") throw missing(); return result;
        },
        async getFileHandle(key: string, options?: { create: boolean }) {
          if (!children.has(key) && options?.create) children.set(key, file(key, "", handle));
          const result = children.get(key); if (result?.kind !== "file") throw missing(); return result;
        },
        async move(destination: any, name: string) { parent?.children.delete(handle.name); destination.children.set(name, handle); handle.name = name; parent = destination; },
      };
      return handle;
    }
    function file(name: string, source: string, parent: any): any {
      let text = source;
      const handle: any = {
        name, kind: "file", getFile: async () => new File([text], handle.name), setText: (value: string) => { text = value; },
        async createWritable() { let pending = text; return { write: async (value: string) => { pending = value; }, close: async () => { text = pending; }, abort: async () => {} }; },
        async move(destination: any, name: string) { parent.children.delete(handle.name); destination.children.set(name, handle); handle.name = name; parent = destination; },
      };
      return handle;
    }
    const root = directory("fixture"), src = await root.getDirectoryHandle("src", { create: true });
    await root.getDirectoryHandle("dest", { create: true });
    src.children.set("sample.c", file("sample.c", "// heading\n".repeat(70) + "return needle; // needle\n", src));
    (window as any).showDirectoryPicker = async () => root;
    (window as any).__localFixture = root;
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  await panel.getByRole("button", { name: "选择本地目录", exact: true }).click();
  const src = panel.locator(".local-file-row").filter({ has: page.locator(".local-file-name", { hasText: /^src$/ }) });
  await src.click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建文件…", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文件", exact: true });
  await create.getByLabel("名称", { exact: true }).fill("draft.c");
  await create.getByRole("button", { name: "确认", exact: true }).click();
  await expect(create).toBeHidden();
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  await expect(viewer.locator(".local-file-titlebar strong")).toHaveText("draft.c");
  await viewer.locator(".cm-content").fill("int created = 7;\n");
  await panel.getByRole("button", { name: "未保存文件与恢复草稿", exact: true }).click();
  const drafts = panel.getByRole("region", { name: "未保存文件", exact: true });
  await expect(drafts.locator("header strong")).toContainText("1");
  await drafts.getByRole("button", { name: "全部保存", exact: true }).click();
  await expect(drafts.getByRole("status")).toContainText("已保存 1 份");
  expect(await page.evaluate(async () => (await (await (window as any).__localFixture.getDirectoryHandle("src")).getFileHandle("draft.c")).getFile().then((file: File) => file.text()))).toBe("int created = 7;\n");
  await drafts.getByRole("button", { name: "关闭未保存文件列表" }).click();
  await panel.locator(".local-file-row").filter({ has: page.locator(".local-file-name", { hasText: /^draft.c$/ }) }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "移动到…", exact: true }).click();
  const move = page.getByRole("dialog", { name: "移动路径", exact: true });
  await move.getByLabel("目标目录", { exact: false }).fill("dest");
  await move.getByRole("button", { name: "确认", exact: true }).click();
  await expect(move).toBeHidden();
  await expect.poll(() => page.evaluate(async () => (window as any).__localFixture.children.get("dest").children.has("draft.c"))).toBe(true);
  await panel.getByRole("button", { name: "目录全文搜索", exact: true }).click();
  const search = panel.getByRole("region", { name: "本地目录全文搜索" });
  await search.getByRole("textbox", { name: "搜索本地文件正文" }).fill("(?<=return )needle");
  await search.getByLabel("Perl 正则").check();
  await search.getByRole("button", { name: "开始全文搜索" }).click();
  await expect(search.getByRole("status").filter({ hasText: "搜索完成" })).toBeVisible();
  await expect(search.locator(".local-file-search-hit")).toHaveCount(1);
  await search.locator(".local-file-search-hit").click();
  await expect(viewer.locator(".local-file-titlebar strong")).toHaveText("sample.c");
  await expect(viewer.locator(".markdown-source-status")).toContainText("71");
  await expect.poll(() => viewer.locator(".cm-scroller").evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  await viewer.locator(".cm-content").fill("my unsaved source");
  await page.evaluate(async () => {
    const src = await (window as any).__localFixture.getDirectoryHandle("src");
    (await src.getFileHandle("sample.c")).setText("external source");
  });
  await panel.getByRole("button", { name: "未保存文件与恢复草稿", exact: true }).click();
  await drafts.getByRole("button", { name: "全部保存", exact: true }).click();
  await expect(drafts.getByRole("status")).toContainText("保存未完成");
  await expect(viewer.getByRole("region", { name: "文件冲突处理" })).toBeVisible();
  await viewer.getByRole("button", { name: "返回原视图", exact: true }).click();
  await drafts.locator(".local-file-draft-row > button:first-child").click();
  await expect(viewer.getByRole("region", { name: "文件冲突处理" })).toBeVisible();
  await drafts.getByRole("button", { name: "全部保存", exact: true }).click();
  await expect(drafts.getByRole("status")).toContainText("保存未完成");
  expect(await page.evaluate(async () => (await (await (window as any).__localFixture.getDirectoryHandle("src")).getFileHandle("sample.c")).getFile().then((file: File) => file.text()))).toBe("external source");
});
