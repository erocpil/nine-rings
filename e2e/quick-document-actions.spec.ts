import { expect, test, type Page } from "@playwright/test";

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
