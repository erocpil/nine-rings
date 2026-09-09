import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, readonly = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15000 });
  const id = await page.evaluate(async readonly => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { mdToDelta } = await load("/src/lib/md-parser.ts") as typeof import("../src/lib/md-parser");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.create({ title: "块工作区测试", date: useNotesStore.getState().currentDate, content: mdToDelta("前文\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```\n\n> 引用第一段\n>\n> 引用第二段\n\n后文") });
    if (readonly) await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote((await api.notes.get(note.id))!);
    return note.id;
  }, readonly);
  await expect(page.locator(".note-title")).toHaveValue("块工作区测试");
  return id;
}

test("块工作区编辑只同步原块并共享撤销，模式不修改文档只读属性", async ({ page }) => {
  const id = await fixture(page);
  const source = page.locator(".note-editor .ProseMirror");
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  const code = dialog.locator("pre code");
  await expect(dialog.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
  await code.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("const updated = 100;");
  await expect(source.locator("pre code")).toHaveText("const updated = 100;");
  await expect(source).toContainText("前文");
  await expect(source).toContainText("后文");
  await dialog.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(code).toContainText("const answer = 42;");
  await dialog.getByRole("button", { name: "重做", exact: true }).click();
  await expect(code).toHaveText("const updated = 100;");
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(source).toHaveAttribute("contenteditable", "true");
  await expect(dialog.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const saved = await page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    return (await api.notes.get(id))?.content;
  }, id);
  expect(JSON.stringify(saved)).toContain("const updated = 100;");
});

test("只读引用弹层没有编辑入口且粘贴无效", async ({ page }) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  const dialog = page.getByRole("dialog", { name: "引用块工作区" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await dialog.locator(".ProseMirror").evaluate(el => {
    const data = new DataTransfer(); data.setData("text/plain", "不允许写入");
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(dialog).not.toContainText("不允许写入");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("手机横竖屏块弹层不超出可视范围", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  const dialog = page.getByRole("dialog", { name: "引用块工作区" });
  for (const viewport of [{ width: 390, height: 760 }, { width: 760, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
    }).toBe(true);
    await page.screenshot({ path: `/tmp/nr-block-workspace-${viewport.width}.png` });
  }
});
