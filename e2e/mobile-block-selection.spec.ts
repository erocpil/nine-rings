import { expect, test, type Locator } from "@playwright/test";

async function swipe(locator: Locator, fromX: number, toX: number, y: number) {
  await locator.evaluate((element, points) => {
    const touch = (clientX: number) => ({ identifier: 91, target: element, clientX, clientY: points.y });
    const dispatch = (type: string, touches: ReturnType<typeof touch>[], changedTouches: ReturnType<typeof touch>[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      element.dispatchEvent(event);
    };
    const start = touch(points.fromX);
    const end = touch(points.toX);
    dispatch("touchstart", [start], [start]);
    dispatch("touchmove", [end], [end]);
    dispatch("touchend", [], [end]);
  }, { fromX, toX, y });
}

test.describe("手机块级操作", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("独立选择、取消、格式化并左划编辑普通块", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
      const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({
        title: "块选择测试",
        date: useNotesStore.getState().currentDate,
        content: { ops: [
          { insert: "第一块" }, { insert: "\n" },
          { insert: "第二块" }, { insert: "\n" },
          { insert: "第三块" }, { insert: "\n" },
        ] },
      });
      useNotesStore.getState().selectNote(note);
    });
    const editor = page.locator(".ProseMirror");
    await expect(editor.locator(":scope > p")).toHaveCount(3);

    await page.getByRole("button", { name: "块级操作", exact: true }).first().tap();
    const selectionToolbar = page.getByRole("toolbar", { name: "块级操作" });
    await expect(selectionToolbar).toContainText("1 块");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "选择到第 3 块" }).tap();
    await expect(selectionToolbar).toContainText("2 块");
    await page.getByRole("button", { name: "选择到第 3 块" }).tap();
    await expect(selectionToolbar).toContainText("1 块");
    await page.getByRole("button", { name: "选择到第 2 块" }).tap();
    await expect(selectionToolbar).toContainText("2 块");
    await selectionToolbar.getByLabel("所选块字号").selectOption("18");
    await expect(editor.locator(':scope > p').nth(1).locator('span[style*="18px"]')).toContainText("第二块");
    await expect(editor.locator(':scope > p').nth(2).locator('span[style*="18px"]')).toHaveCount(0);

    await page.getByRole("button", { name: "选择到第 1 块" }).tap();
    await expect(selectionToolbar).toContainText("1 块");
    await page.getByRole("button", { name: "选择到第 2 块" }).tap();
    await expect(selectionToolbar).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await page.getByRole("button", { name: "块级操作", exact: true }).first().tap();
    await expect(selectionToolbar).toContainText("1 块");
    const second = editor.locator(":scope > p").nth(1);
    const box = await second.boundingBox();
    expect(box).not.toBeNull();
    await swipe(second, box!.x + box!.width - 8, box!.x + 20, box!.y + box!.height / 2);
    await expect(page.getByRole("dialog", { name: "正文块工作区" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "块编辑工具" })).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "关闭块工作区" }).tap();
    await expect(selectionToolbar).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "true");
  });

  test("大文档改成引用后外壳操作仍可响应", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
      const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
      const ops: Array<{ insert: string; attributes?: { header: number } }> = [
        { insert: "大文档目录" }, { insert: "\n", attributes: { header: 1 } },
      ];
      for (let index = 0; index < 400; index += 1) ops.push({ insert: `正文 ${index}` }, { insert: "\n" });
      const note = await api.notes.create({ title: "大文档交互", date: useNotesStore.getState().currentDate, content: { ops } });
      useNotesStore.getState().selectNote(note);
    });
    const editor = page.locator(".ProseMirror");
    await expect(editor.locator(":scope > *")).toHaveCount(401);
    await editor.evaluate((element) => {
      const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      let position = 0;
      for (let index = 0; index < 200; index += 1) position += instance.state.doc.child(index).nodeSize;
      instance.chain().setTextSelection(position + 1).toggleBlockquote().run();
    });
    await expect(editor.locator("blockquote")).toHaveCount(1);
    await page.getByTitle("专注模式").tap();
    await expect(page.getByRole("button", { name: "退出专注模式" })).toBeVisible();
    await page.getByRole("button", { name: "退出专注模式" }).tap();
    await page.getByRole("button", { name: "点击设为只读" }).tap();
    await expect(page.getByRole("button", { name: "点击设为可编辑" })).toBeVisible();
  });
});
