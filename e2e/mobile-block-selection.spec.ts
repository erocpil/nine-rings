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

  test("独立选择、取消、格式化并通过按钮编辑，左划不再进入编辑", async ({ page }) => {
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
    await editor.locator(":scope > p").nth(2).tap();
    await expect(selectionToolbar).toContainText("2 块");
    await expect(page.getByRole("button", { name: "选择第 3 块" })).toHaveAttribute("aria-pressed", "true");
    await editor.locator(":scope > p").nth(2).tap();
    await expect(selectionToolbar).toContainText("1 块");
    await expect(page.getByRole("button", { name: "选择第 3 块" })).toHaveAttribute("aria-pressed", "false");
    await editor.locator(":scope > p").nth(1).tap();
    await expect(selectionToolbar).toContainText("2 块");
    await selectionToolbar.getByLabel("所选块字号").selectOption("18");
    await expect(editor.locator(':scope > p').nth(1).locator('span[style*="18px"]')).toContainText("第二块");
    await expect(editor.locator(':scope > p').nth(2).locator('span[style*="18px"]')).toHaveCount(0);

    await editor.locator(":scope > p").nth(0).tap();
    await expect(selectionToolbar).toContainText("1 块");
    await editor.locator(":scope > p").nth(1).locator("span").tap();
    await expect(selectionToolbar).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await page.getByRole("button", { name: "块级操作", exact: true }).first().tap();
    await expect(selectionToolbar).toContainText("1 块");
    const second = editor.locator(":scope > p").nth(1);
    const box = await second.boundingBox();
    expect(box).not.toBeNull();
    await swipe(second, box!.x + box!.width / 2, box!.x + 20, box!.y + box!.height / 2);
    await expect(page.locator(".block-workspace")).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(selectionToolbar).toBeVisible();
    await expect(selectionToolbar).toContainText("1 块");
    await expect(selectionToolbar.getByRole("button", { name: "复制", exact: true })).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "编辑", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: "正文块工作区" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "块编辑工具" })).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "关闭块工作区" }).tap();
    await expect(page.locator(".block-workspace")).toHaveCount(0);
    await expect(selectionToolbar).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "true");
  });

  test("多选不同类型块按文档顺序切换，编辑长度改变后仍只切换已选块", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const noteId = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
      const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({ title: "多块编辑测试", date: useNotesStore.getState().currentDate,
        content: { ops: [
          { insert: "已选正文" }, { insert: "\n" },
          { insert: "跳过的正文" }, { insert: "\n" },
          { insert: "已选标题" }, { insert: "\n", attributes: { header: 2 } },
          { insert: "末尾不选" }, { insert: "\n" },
        ] },
      });
      useNotesStore.getState().selectNote(note);
      return note.id;
    });
    await expect(page.locator(".note-title")).toHaveValue("多块编辑测试");
    await page.getByRole("button", { name: "块级操作", exact: true }).tap();
    await page.locator(".ProseMirror > h2").tap();
    const toolbar = page.getByRole("toolbar", { name: "块级操作" });
    await expect(toolbar).toContainText("2 块");
    expect(await toolbar.getByRole("button", { name: "复制", exact: true }).evaluate(element => element.nextElementSibling?.textContent)).toBe("编辑");
    await toolbar.getByRole("button", { name: "编辑", exact: true }).tap();
    const workspace = page.locator(".block-workspace");
    const content = workspace.locator(".ProseMirror");
    await expect(content).toHaveText("已选正文");
    await expect(workspace.getByRole("toolbar", { name: "块编辑工具" })).toBeVisible();
    await expect(workspace.getByRole("button", { name: "上一个块", exact: true })).toBeDisabled();
    await content.fill("已选正文增加很多文字，验证后面的块位置会随编辑更新");
    await workspace.getByRole("button", { name: "下一个块", exact: true }).tap();
    await expect(workspace).toHaveAttribute("data-block-type", "heading");
    await expect(content).toHaveText("已选标题");
    await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(workspace.getByRole("button", { name: "下一个块", exact: true })).toBeDisabled();
    await content.fill("修改后的标题");
    await workspace.getByRole("button", { name: "上一个块", exact: true }).tap();
    await expect(content).toHaveText("已选正文增加很多文字，验证后面的块位置会随编辑更新");
    await content.fill("缩短");
    await workspace.getByRole("button", { name: "下一个块", exact: true }).tap();
    await expect(content).toHaveText("修改后的标题");
    await workspace.getByRole("button", { name: "关闭块工作区" }).tap();
    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async (id) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
      const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
      useNotesStore.getState().selectNote((await api.notes.get(id))!);
    }, noteId);
    const editor = page.locator(".ProseMirror");
    await expect(editor.locator(":scope > p").first()).toHaveText("缩短");
    await expect(editor.locator(":scope > h2")).toContainText("修改后的标题");
    await expect(editor.locator(":scope > p").nth(1)).toHaveText("跳过的正文");
    await expect(editor.locator(":scope > p").nth(2)).toHaveText("末尾不选");
  });

  test("只读块点击嵌套正文及控件只切换所属块，块号和折叠区域共同高亮", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await editor.evaluate((element) => {
      const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      instance.commands.setContent({ type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "起始块" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "可折叠标题" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用内部" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表内部" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "链接内部", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
        { type: "codeBlock", content: [{ type: "text", text: "代码内部" }] },
        { type: "paragraph" },
      ] });
      instance.commands.setTextSelection(1);
    });
    await page.getByRole("button", { name: "点击设为只读" }).tap();
    await page.getByRole("button", { name: "块级操作", exact: true }).first().tap();
    const toolbar = page.getByRole("toolbar", { name: "块级操作" });
    const headingGutter = page.getByRole("button", { name: "选择第 2 块" });
    await expect(headingGutter).toHaveText("2");
    await expect(headingGutter.locator(".disclosure-icon")).toHaveClass(/expanded/);
    await expect(headingGutter).toHaveCSS("width", "36px");
    await headingGutter.locator(".editor-block-select-fold").tap();
    await expect(headingGutter).toHaveClass(/selected/);
    await expect(headingGutter).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator("blockquote")).toBeVisible();
    expect(await headingGutter.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await editor.locator(":scope > h2").tap();
    await expect(headingGutter).not.toHaveClass(/selected/);
    for (const [target, number] of [
      [editor.locator("blockquote p"), 3],
      [editor.locator("li p"), 4],
      [editor.locator("a"), 5],
      [editor.locator("code"), 6],
      [editor.locator(":scope > p").last(), 7],
    ] as const) {
      await target.tap();
      await expect(toolbar).toContainText("2 块");
      await expect(page.getByRole("button", { name: `选择第 ${number} 块` })).toHaveAttribute("aria-pressed", "true");
      await target.tap();
      await expect(toolbar).toContainText("1 块");
    }
    await expect(page.locator(".block-workspace")).toHaveCount(0);
    expect((await page.locator(".editor-block-select").allTextContents()).join("")).not.toMatch(/[○✓]/);
    // Mouse clicks follow the same path without depending on touch synthesis.
    await page.waitForTimeout(850);
    await editor.locator("blockquote p").click();
    await expect(toolbar).toContainText("2 块");
    await editor.locator("blockquote p").click();
    await expect(toolbar).toContainText("1 块");
    await editor.locator(":scope > p").first().tap();
    await expect(toolbar).toHaveCount(0);
    await expect(editor).toHaveAttribute("contenteditable", "false");
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
