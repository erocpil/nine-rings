import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const create = (title: string, path: string) => api.notes.create({ title, date: useNotesStore.getState().currentDate, storagePath: path, content: { ops: [{ insert: title }, { insert: "\n" }] } });
    const first = await create("路径操作正文", "references/操作目录");
    const child = await create("子目录文档", "references/操作目录/子目录");
    const sibling = await create("相似前缀文档", "references/操作目录其它");
    useNotesStore.getState().selectNote(first);
    return [first.id, child.id, sibling.id];
  });
  await expect(page.locator(".ProseMirror")).toContainText("路径操作正文");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("路径操作正文");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { document.body.dataset.copiedPath = text; } } });
  });
  return ids;
}

const folder = (page: Page) => page.locator(".app-sidebar .doc-tree-folder").filter({ has: page.locator(".doc-tree-name", { hasText: /^操作目录$/ }) });

test("桌面右键复制目录和文档所在路径，复制失败不假报成功", async ({ page }) => {
  await fixture(page);
  await folder(page).click({ button: "right" });
  await page.locator(".doc-context-item").getByText("复制路径", { exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-copied-path", "references/操作目录");
  await page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "路径操作正文" }).click({ button: "right" });
  await page.locator(".doc-context-item").getByText("复制所在路径", { exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-copied-path", "references/操作目录");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    document.execCommand = () => false;
  });
  await folder(page).click({ button: "right" });
  await page.locator(".doc-context-item").getByText("复制路径", { exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "复制路径失败" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "已复制路径" })).toHaveCount(0);
});

test.describe("手机目录操作", () => {
  test.use({ hasTouch: true });
  test("点击目录计数选中并保留抽屉，顶部复制、取消删除、删除含子目录且不误删相似前缀", async ({ page }) => {
    const ids = await fixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await folder(page).locator(".doc-tree-count").click();
    await expect(folder(page)).toHaveClass(/doc-tree-selected/);
    await expect(page.getByRole("dialog", { name: "文档侧栏" })).toBeVisible();
    const copy = page.getByTitle("复制路径", { exact: true });
    await copy.click();
    await expect(page.locator("body")).toHaveAttribute("data-copied-path", "references/操作目录");
    const del = page.getByTitle("删除选中目录", { exact: true });
    page.once("dialog", async dialog => { expect(dialog.message()).toContain("2 篇文档"); await dialog.dismiss(); });
    await del.click();
    await expect(folder(page)).toBeVisible();
    page.once("dialog", async dialog => { expect(dialog.message()).toContain("包含子目录"); await dialog.accept(); });
    await del.click();
    await expect(folder(page)).toHaveCount(0);
    const deleted = await page.evaluate(async ids => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { getAdapter } = await load("/src/lib/storage/index.ts");
      const notes = await (await getAdapter()).getDeletedNotes();
      return ids.map((id: string) => notes.some((note: { id: string }) => note.id === id));
    }, ids);
    expect(deleted).toEqual([true, true, false]);
  });
});
