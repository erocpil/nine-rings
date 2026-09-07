import { expect, test } from "@playwright/test";

test("新建表单校验路径，添加标签不提交，创建失败可重试", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const create = api.notes.create;
    let calls = 0;
    api.notes.create = async (...args: unknown[]) => {
      calls++;
      document.body.dataset.createCalls = String(calls);
      if (calls === 1) throw new Error("模拟存储失败");
      return create(...args);
    };
  });
  await page.getByTitle("新建文档").click();
  const dialog = page.getByRole("dialog", { name: "新建文档", exact: true });
  await dialog.getByPlaceholder("文档标题...").fill("表单优化验证");
  await dialog.getByPlaceholder("输入概念名后按 Enter 添加...").fill("交互");
  await dialog.getByPlaceholder("输入概念名后按 Enter 添加...").press("Enter");
  await expect(dialog.locator(".dialog-tag")).toContainText("交互");
  expect(await page.evaluate(() => document.body.dataset.createCalls)).toBeUndefined();
  await dialog.getByLabel("顶级目录", { exact: true }).selectOption("__custom_root__");
  await dialog.getByLabel("自定义目录", { exact: true }).fill("daily/private");
  await expect(dialog.getByRole("button", { name: "创建", exact: true })).toBeDisabled();
  await expect(dialog.locator(".ui-field-error")).toContainText("daily");
  await dialog.getByLabel("自定义目录", { exact: true }).fill("areas/private");
  await expect(dialog.locator(".dialog-path-preview code")).toHaveText("areas/private");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟存储失败");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".note-title")).toHaveValue("表单优化验证");
  expect(await page.evaluate(() => document.body.dataset.createCalls)).toBe("2");
});

test("快速切换提供加载失败重试、空状态与完整长路径", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const path = "areas/" + "很长的目录名称/".repeat(8) + "private";
  const title = "很长的文档标题".repeat(16);
  await page.evaluate(async ({ path, title }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.notes.create({ date: "2026-09-07", title, storagePath: path });
    const all = api.notes.all;
    let attempts = 0;
    api.notes.all = async () => { if (attempts++ === 0) throw new Error("test"); return all(); };
  }, { path, title });
  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "快速切换笔记" });
  await expect(dialog.getByRole("alert")).toContainText("载入失败");
  await dialog.getByRole("button", { name: "重新加载" }).click();
  const input = dialog.getByRole("combobox");
  await input.fill("不存在的关键词");
  await expect(dialog.getByRole("status")).toContainText("没有找到匹配的笔记");
  await input.fill("很长的文档标题");
  await expect(dialog.locator(".ui-list-title")).toHaveAttribute("title", title);
  await expect(dialog.locator(".ui-list-path")).toHaveAttribute("title", path);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await input.press("Enter");
  await expect(page.locator(".note-title")).toHaveValue(title);
});

test("移动表单目录加载可重试，目标路径完整预览", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { MoveToDialog } = await load("/src/components/MoveToDialog.tsx");
    const { api } = await load("/src/lib/api.ts");
    let attempts = 0;
    api.docs.tree = async () => {
      if (attempts++ === 0) throw new Error("模拟目录读取失败");
      return [{ type: "folder", path: "archives/old", name: "old" }];
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(React.createElement(MoveToDialog, {
      subject: { kind: "document", title: "待移动文档", currentPath: "areas/private" },
      onClose: () => root.unmount(),
      onMove: async (path: string) => { document.body.dataset.movedPath = path; },
    }));
  });
  const dialog = page.getByRole("dialog", { name: "移动到", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("模拟目录读取失败");
  await dialog.getByRole("button", { name: "重新加载" }).click();
  await expect(dialog.getByRole("option", { name: "archives/old" })).toBeVisible();
  const path = "archives/" + "很长的目录/".repeat(10) + "final";
  await dialog.getByPlaceholder("例如 archives/old").fill(path);
  await expect(dialog.locator(".move-to-preview code").last()).toHaveText(path);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.movedPath)).toBe(path);
});
