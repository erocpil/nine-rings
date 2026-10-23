import { expect, test, type Page } from "@playwright/test";
import { selectDocumentLanguage } from "./helpers/source-editor";

async function createInPath(page: Page, title: string, storagePath: string, language = "") {
  return page.evaluate(async ({ title, storagePath, language }) => {
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await import(/* @vite-ignore */ "/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title,
      storagePath,
      date: useNotesStore.getState().currentDate,
      content: { ops: [], metadata: language ? { sourceLanguage: language } : undefined },
    });
    useNotesStore.getState().selectNote(note);
    return note.id;
  }, { title, storagePath, language });
}

async function getNote(page: Page, id: string) {
  return page.evaluate(async noteId => {
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ "/src/lib/api.ts");
    return api.notes.get(noteId);
  }, id);
}

for (const mode of ["source", "rendered"] as const) {
  test(`${mode} 清空标题仍保留唯一默认名，新建和重新打开后不消失`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const path = `ideas/empty-title-${mode}`;
    await createInPath(page, "命名回归", path);
    await page.reload();
    const folder = page.locator(".app-sidebar .doc-tree-folder").filter({ has: page.locator(".doc-tree-name", { hasText: new RegExp(`^empty-title-${mode}$`) }) });
    const create = folder.getByRole("button", { name: `在路径 ${path} 中新建文档`, exact: true });
    await folder.hover();
    await create.click();
    const title = page.locator(".note-title:visible");
    await expect(title).toHaveValue("未命名");
    const firstId = (await page.evaluate(() => localStorage.getItem("nr:lastNote")))!;
    if (mode === "rendered") {
      await selectDocumentLanguage(page, "markdown");
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect(page.locator(".ProseMirror")).toBeEditable();
    }
    await title.fill("");
    await expect(page.locator(".app-sidebar .doc-tree-selected .doc-tree-name")).toHaveText("未命名");
    await expect.poll(async () => (await getNote(page, firstId))?.title).toBe("未命名");
    // The persisted name is nonempty while a focused draft remains clearable.
    await expect(title).toHaveValue("");
    await folder.hover();
    await create.click();
    await expect(title).toHaveValue("未命名 2");
    const secondId = (await page.evaluate(() => localStorage.getItem("nr:lastNote")))!;
    await page.locator(".app-sidebar").getByRole("button", { name: "未命名", exact: true }).click();
    await expect(title).toHaveValue("未命名");
    await title.fill("临时名称");
    await expect.poll(async () => (await getNote(page, firstId))?.title).toBe("临时名称");
    await title.fill("   ");
    // Creating immediately must flush and normalize the previous title first.
    await folder.hover();
    await create.click();
    await expect(title).toHaveValue("未命名 3");
    expect((await getNote(page, firstId))?.title).toBe("未命名");
    expect((await getNote(page, secondId))?.title).toBe("未命名 2");
    await page.locator(".app-sidebar").getByRole("button", { name: "未命名 2", exact: true }).click();
    await title.fill("");
    await title.press("Tab");
    await expect(title).toHaveValue("未命名 2");
    await page.reload();
    await expect(title).toHaveValue("未命名 2");
    await expect(page.locator(".app-sidebar .doc-tree-selected .doc-tree-name")).toHaveText("未命名 2");
  });
}

test("路径悬停加号与状态栏加号创建唯一的未命名文本文档", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await createInPath(page, "路径加号测试源", "ideas/quick-create-test");
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("路径加号测试源");

  const folder = page.locator(".app-sidebar .doc-tree-folder").filter({
    has: page.locator(".doc-tree-name", { hasText: /^quick-create-test$/ }),
  });
  await folder.hover();
  const pathCreate = folder.getByRole("button", { name: "在路径 ideas/quick-create-test 中新建文档" });
  await expect(pathCreate).toBeVisible();
  await pathCreate.click();
  await expect(page.locator(".note-title")).toHaveValue("未命名");
  const firstId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  expect(firstId).toBeTruthy();
  const first = await getNote(page, firstId!);
  expect(first?.storagePath).toBe("ideas/quick-create-test");
  expect(first?.content.metadata?.sourceFormat).toBe("text");

  await page.getByRole("button", { name: "在当前路径新建文档" }).click();
  await expect(page.locator(".note-title")).toHaveValue("未命名 2");
  const secondId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  const second = await getNote(page, secondId!);
  expect(second?.storagePath).toBe("ideas/quick-create-test");
  expect(second?.content.metadata?.sourceFormat).toBe("text");
});

test("源码格式文档标题可编辑，悬停仍显示文档信息，状态栏加号沿用格式和路径", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sourceId = await createInPath(page, "源码标题测试", "areas/source-create-test", "c");
  await page.reload();

  const title = page.locator(".markdown-source-title-row .note-title");
  await expect(title).toHaveValue("源码标题测试");
  await title.fill("重命名后的 C 文档");
  await title.press("Tab");
  await expect.poll(async () => (await getNote(page, sourceId))?.title).toBe("重命名后的 C 文档");

  await page.locator(".markdown-source-title-row .note-title-field").hover({ position: { x: 12, y: 15 } });
  await expect(page.getByRole("tooltip", { name: /重命名后的 C 文档 的文档信息/ })).toBeVisible();

  await page.getByRole("button", { name: "在当前路径新建文档" }).click();
  await expect(page.locator(".note-title")).toHaveValue("未命名");
  const createdId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  const created = await getNote(page, createdId!);
  expect(created?.storagePath).toBe("areas/source-create-test");
  expect(created?.content.metadata?.sourceLanguage).toBe("c");
});
