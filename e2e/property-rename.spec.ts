import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
    const create = (title: string, storagePath: string) => api.notes.create({ title, storagePath,
      date: useNotesStore.getState().currentDate, content: { ops: [{ insert: "重命名前的正文" }, { insert: "\n" }] },
    });
    const note = await create("属性重命名文档", "references/原路径");
    const child = await create("子目录文档", "references/原路径/子路径");
    const other = await create("同级文档", "references/已有路径");
    useNotesStore.getState().selectNote(note);
    return { note: note.id, child: child.id, other: other.id };
  });
  await expect(page.locator(".note-title")).toHaveValue("属性重命名文档");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return ids;
}

const folder = (page: Page, name: string) => page.locator(".app-sidebar .doc-tree-folder").filter({ has: page.locator(".doc-tree-name", { hasText: new RegExp(`^${name}$`) }) });
async function openProperties(page: Page) {
  if (!await page.locator(".properties-panel").isVisible()) await page.getByTitle("显示属性面板", { exact: true }).click();
  return page.locator(".properties-panel");
}

test("路径选中高亮及属性重命名同步更新子文档，刷新后保留", async ({ page }) => {
  const ids = await fixture(page);
  const old = folder(page, "原路径");
  await old.locator(".doc-tree-name").click();
  await expect(old).toHaveClass(/doc-tree-selected/);
  await expect(old).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".doc-tree-doc.doc-tree-selected")).toHaveCount(0);
  const panel = await openProperties(page);
  await panel.getByRole("button", { name: "重命名路径", exact: true }).click();
  await panel.getByRole("textbox", { name: "路径新名称" }).fill("新路径");
  await panel.getByRole("button", { name: "保存名称" }).click();
  await expect(panel).toContainText("references/新路径");
  await expect(folder(page, "新路径")).toHaveClass(/doc-tree-selected/);
  await expect(old).toHaveCount(0);
  const paths = await page.evaluate(async ids => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    return Promise.all([ids.note, ids.child, ids.other].map(async id => (await api.notes.get(id))!.storagePath));
  }, ids);
  expect(paths).toEqual(["references/新路径", "references/新路径/子路径", "references/已有路径"]);
  await page.reload();
  await expect(folder(page, "新路径")).toHaveClass(/doc-tree-selected/);
  await page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "属性重命名文档" }).click();
  await expect(folder(page, "新路径")).not.toHaveClass(/doc-tree-selected/);
});

test("路径重命名校验、取消与失败保留原路径", async ({ page }) => {
  await fixture(page);
  await folder(page, "原路径").locator(".doc-tree-name").click();
  const panel = await openProperties(page);
  await panel.getByRole("button", { name: "重命名路径", exact: true }).click();
  const input = panel.getByRole("textbox", { name: "路径新名称" });
  for (const [name, message] of [[" ", "名称不能为空"], ["../越级", "斜杠"], ["已有路径", "同级路径已存在"]]) {
    await input.fill(name);
    await panel.getByRole("button", { name: "保存名称" }).click();
    await expect(panel.getByRole("alert")).toContainText(message);
    await expect(folder(page, "原路径")).toHaveClass(/doc-tree-selected/);
  }
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(panel).toContainText("references/原路径");
});

for (const width of [1280, 390]) {
  test(`属性文档重命名同步标题和树，保留待保存正文（${width}px）`, async ({ page }) => {
    await fixture(page);
    await page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "属性重命名文档" }).click();
    const panel = await openProperties(page);
    await page.setViewportSize({ width, height: 800 });
    await page.locator(".note-editor .ProseMirror").fill("刚修改且需要保留的正文");
    await panel.getByRole("button", { name: "重命名文档", exact: true }).click();
    const input = panel.getByRole("textbox", { name: "文档新名称" });
    await input.fill("修改后的文档名");
    await input.press("Enter");
    await expect(panel.getByRole("button", { name: "重命名文档", exact: true })).toBeVisible();
    await expect(page.locator(".note-title")).toHaveValue("修改后的文档名");
    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue("修改后的文档名");
    await expect(page.locator(".note-editor .ProseMirror")).toContainText("刚修改且需要保留的正文");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "点击设为只读" }).click();
    await openProperties(page);
    await expect(panel.getByRole("button", { name: "重命名文档", exact: true })).toBeDisabled();
  });
}

test("文档名称保存失败后保留输入并可重试", async ({ page }) => {
  const ids = await fixture(page);
  await page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "属性重命名文档" }).click();
  const panel = await openProperties(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const original = api.notes.update;
    api.notes.update = async (id, patch) => {
      if (patch.title === "失败重试标题" && !document.documentElement.hasAttribute("data-allow-rename")) throw new Error("模拟保存失败");
      return original(id, patch);
    };
  });
  await panel.getByRole("button", { name: "重命名文档", exact: true }).click();
  await panel.getByRole("textbox", { name: "文档新名称" }).fill("失败重试标题");
  await panel.getByRole("button", { name: "保存名称" }).click();
  await expect(panel.getByRole("alert")).toContainText("重命名失败");
  await expect(panel.getByRole("textbox", { name: "文档新名称" })).toHaveValue("失败重试标题");
  await page.evaluate(() => document.documentElement.setAttribute("data-allow-rename", "true"));
  await page.getByRole("button", { name: "关闭错误详情", exact: true }).click();
  await panel.getByRole("button", { name: "保存名称" }).click();
  await expect(panel.getByRole("button", { name: "重命名文档", exact: true })).toBeVisible();
  expect(await page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    return (await api.notes.get(id))!.title;
  }, ids.note)).toBe("失败重试标题");
});
