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

test("阅读空白标记不进入复制，查找替换仅影响当前块", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "块显示设置" }).click();
  await dialog.getByLabel("显示空白字符").selectOption("all");
  await expect(dialog.locator(".workspace-ws-space").first()).toBeVisible();
  await expect(dialog.locator(".workspace-ws-newline")).toHaveCount(1);
  await dialog.getByLabel("Tab 显示宽度").selectOption("8");
  await expect(dialog.locator(".ProseMirror")).toHaveCSS("tab-size", "8");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => {
    document.documentElement.dataset.blockCopy = await (await items[0].getType("text/plain")).text();
  } }));
  await dialog.getByRole("button", { name: "复制块", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-block-copy", "const answer = 42;\nconsole.log(answer);");
  await expect(dialog.getByText("已复制块（保留格式）")).toBeVisible();
  await expect(dialog.getByText("已复制块（保留格式）")).toHaveCount(0, { timeout: 4000 });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(dialog.getByLabel("显示空白字符")).toHaveCount(0);
  await expect(dialog.locator(".workspace-ws-space")).toHaveCount(0);
  await dialog.getByRole("button", { name: "块内查找", exact: true }).click();
  await dialog.getByLabel("在当前块查找").fill("answer");
  await dialog.getByLabel("当前块替换为").fill("result");
  await dialog.getByRole("button", { name: "替换本块全部", exact: true }).click();
  await expect(page.locator(".note-editor .ProseMirror pre code")).toHaveText("const result = 42;\nconsole.log(result);");
  await expect(page.locator(".note-editor .ProseMirror")).toContainText("引用第一段");
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(dialog.getByLabel("显示空白字符")).toHaveValue("all");
  await expect(dialog.locator(".workspace-ws-space").first()).toBeVisible();
});

test("长代码正文限高而弹层保持单一纵向滚动区", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.locator("pre code").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(Array.from({ length: 150 }, (_, i) => `line${i}`).join("\n"));
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await dialog.getByRole("button", { name: "块显示设置" }).click();
  await dialog.getByLabel("正文代码最大高度").selectOption("40");
  const sourceInner = page.locator(".note-editor .code-block-inner");
  await expect.poll(async () => (await sourceInner.boundingBox())!.height).toBeLessThanOrEqual(321);
  await expect(dialog.locator(".code-block-inner")).toHaveCSS("max-height", "none");
  expect(await dialog.locator(".block-workspace-body").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await dialog.locator("pre").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await dialog.getByLabel("跳转代码行").fill("140");
  await dialog.getByRole("button", { name: "跳转", exact: true }).click();
  expect(await dialog.locator(".block-workspace-body").evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
});
