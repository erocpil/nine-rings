import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

async function setup(page: Page, readonly = false, virtual = false, exhibition = false, showNumbers = true) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript(({ virtual, exhibition, showNumbers }) => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: showNumbers, ...(exhibition ? { workspace_layout: "exhibition", interface_style: "calm" } : {}) }));
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
  }, { virtual, exhibition, showNumbers });
  await createBlankDocument(page, "块号菜单");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").evaluate((element) => {
    const editor = (element as any).editor;
    editor.commands.setContent({ type: "doc", content: ["first", "second", "third"].map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) }, true);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  if (readonly) {
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (virtual) await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  }
  await page.setViewportSize(viewport);
  if (showNumbers) await expect(page.locator(".editor-block-number").first()).toBeVisible();
}
const menu = (page: Page) => page.getByRole("menu", { name: "第 1 块", exact: true });
async function open(page: Page) { await page.getByRole("button", { name: "第 1 块操作", exact: true }).click(); await expect(menu(page)).toBeVisible(); }

test("结构块复制保留 Markdown，折叠操作和菜单键盘关闭不改写内容", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => {
    (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] }, { type: "paragraph", content: [{ type: "text", text: "after" }] }] }, true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).blockCopied = text; } } });
  });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "复制 Markdown", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).blockCopied)).toMatch(/```javascript\nconst x = 1;\n```/);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "折叠 / 展开此块", exact: true }).click();
  await expect(root.locator(".code-block-wrap")).toHaveClass(/collapsed/);
  await open(page);
  await page.keyboard.press("End");
  await expect(menu(page).getByRole("menuitem", { name: "删除此块", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  expect(await root.evaluate(element => (element as any).editor.state.doc.textContent)).toBe("const x = 1;after");
});

test("分割线缩进只作用于此块，不把下一个段落当成目标", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }, { type: "horizontalRule" }, { type: "paragraph", content: [{ type: "text", text: "after" }] }] }, true));
  await page.getByRole("button", { name: "第 2 块操作", exact: true }).click();
  const popup = page.getByRole("menu", { name: "第 2 块", exact: true });
  await expect(popup.getByRole("menuitem", { name: "添加块书签", exact: true })).toBeDisabled();
  await popup.getByRole("menuitem", { name: "增加缩进", exact: true }).click();
  expect(await root.evaluate(element => {
    const doc = (element as any).editor.state.doc;
    return [doc.child(1).attrs.indent, doc.child(2).attrs.indent];
  })).toEqual([1, 0]);
});

test("块号菜单针对点击块操作，复制副本、删除、转换可撤销，支持多选", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  const before = await root.evaluate(element => (element as any).editor.state.selection.from);
  await open(page);
  expect(await root.evaluate(element => (element as any).editor.state.selection.from)).toBe(before);
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await page.getByRole("button", { name: "第 3 块操作", exact: true }).click();
  await expect(page.getByRole("menu", { name: "第 3 块", exact: true })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "复制副本", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["first", "first", "second", "third"]);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "删除此块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["second", "third"]);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "转换类型", exact: false }).click();
  await menu(page).getByRole("menuitem", { name: "H3", exact: true }).click();
  await expect(root.locator("h3")).toHaveText("first");
  await root.evaluate(element => (element as any).editor.commands.undo());
  await open(page);
  await menu(page).getByRole("menuitem", { name: "选择多个块", exact: true }).click();
  await page.getByRole("button", { name: "选择第 2 块", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "块级操作" })).toContainText("2 块");
});

for (const virtual of [false, true]) test(`只读块号菜单可复制和添加书签，不显示正文修改，局部=${virtual}`, async ({ page }) => {
  await setup(page, true, virtual);
  await open(page);
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await open(page);
  await expect(menu(page).getByRole("menuitem", { name: "复制块引用", exact: true })).toBeVisible();
  for (const name of ["粗体", "斜体", "文字字号", "文字颜色", "删除此块", "清除文字样式", "剪切此块", "在本块前粘贴块", "在本块后粘贴块"]) await expect(menu(page).getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  await menu(page).getByRole("menuitem", { name: "添加块书签", exact: true }).click();
  await open(page);
  await expect(menu(page).getByRole("menuitem", { name: "取消块书签", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "第 1 块操作", exact: true })).toBeFocused();
});

test.describe("手机块类型预览", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  for (const virtual of [false, true]) test(`右划显示类型、松开恢复且不弹菜单，轻点仍打开，局部=${virtual}`, async ({ page }) => {
    await setup(page, virtual, virtual);
    const number = page.getByRole("button", { name: "第 1 块操作", exact: true });
    await number.evaluate(element => {
      const event = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: [{ identifier: 1, clientX: 20, clientY: 200 }] });
      element.dispatchEvent(event);
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: [{ identifier: 1, clientX: 65, clientY: 201 }] });
      element.dispatchEvent(move);
    });
    await expect(number).toHaveClass(/block-type-preview/);
    await expect.poll(() => number.evaluate(element => getComputedStyle(element, "::after").visibility)).toBe("visible");
    await number.evaluate(element => {
      const event = new Event("touchend", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "changedTouches", { value: [{ identifier: 1, clientX: 65, clientY: 201 }] });
      element.dispatchEvent(event);
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect(number).not.toHaveClass(/block-type-preview/);
    await expect.poll(() => number.evaluate(element => getComputedStyle(element, "::after").visibility)).toBe("hidden");
    await expect(menu(page)).toHaveCount(0);
    await number.tap();
    await expect(menu(page)).toBeVisible();
    const rect = (await menu(page).boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(8);
    expect(rect.x + rect.width).toBeLessThanOrEqual(382);
    expect(rect.y + rect.height).toBeLessThanOrEqual(836);
    await number.tap();
    await expect(menu(page)).toHaveCount(0);
    await number.tap();
    await expect(menu(page)).toBeVisible();
  });
});

test("清除文字样式保留链接、行内代码、块结构，且可单步撤销", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => {
    (element as any).editor.commands.setContent({ type: "doc", content: [
      { type: "blockquote", content: [{ type: "paragraph", content: [
        { type: "text", text: "link", marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: "#ff0000", fontSize: "24px" } }, { type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: "code", marks: [{ type: "code" }] },
      ] }] }, { type: "paragraph", content: [{ type: "text", text: "after", marks: [{ type: "bold" }] }] },
    ] }, true);
    (window as any).blockBefore = (element as any).editor.getJSON();
  });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "清除文字样式", exact: true }).click();
  const result = await root.evaluate(element => (element as any).editor.getJSON());
  expect(result.content[0].type).toBe("blockquote");
  expect(result.content[0].content[0].content.map((node: any) => node.marks.map((mark: any) => mark.type))).toEqual([["link"], ["code"]]);
  expect(result.content[1].content[0].marks[0].type).toBe("bold");
  await root.evaluate(element => (element as any).editor.commands.undo());
  expect(await root.evaluate(element => (element as any).editor.getJSON())).toEqual(await page.evaluate(() => (window as any).blockBefore));
});

test("块前后粘贴独立的 Markdown 和富文本块，保留列表结构并可撤销", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "- item\n\n```js\nconst a = 1;\n```" } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块前粘贴块", exact: true }).click();
  await expect.poll(() => root.evaluate(element => (element as any).editor.getJSON().content.map((node: any) => node.type))).toEqual(["bulletList", "codeBlock", "paragraph", "paragraph", "paragraph"]);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: async () => [new ClipboardItem({ "text/plain": new Blob(["quote\nsecond quote"], { type: "text/plain" }), "text/html": new Blob(["<blockquote><p>quote</p><p><strong>second quote</strong></p></blockquote>"], { type: "text/html" }) })] } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块后粘贴块", exact: true }).click();
  await expect.poll(() => root.evaluate(element => (element as any).editor.getJSON().content.map((node: any) => node.type))).toEqual(["paragraph", "blockquote", "paragraph", "paragraph"]);
  expect(await root.evaluate(element => (element as any).editor.getJSON().content[1].content.length)).toBe(2);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
});

test("剪切保留完整块和同文档引用、书签身份，移动与撤销保持一致", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => {
    const editor = (element as any).editor;
    editor.commands.setTextSelection(1);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      write: async (items: ClipboardItem[]) => { (window as any).cutItems = items; },
      read: async () => (window as any).cutItems,
    } });
  });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "添加块书签", exact: true }).click();
  await open(page);
  await menu(page).getByRole("menuitem", { name: "复制块引用", exact: true }).click();
  // Wait for reference creation/save to finish before cutting the snapshot.
  await expect.poll(() => root.evaluate(element => (element as any).editor.state.plugins.flatMap((plugin: any) => plugin.getState((element as any).editor.state)?.anchors ?? []).length)).toBe(1);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "剪切此块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["second", "third"]);
  const metadata = () => root.evaluate(element => {
    const editor = (element as any).editor;
    const states = editor.state.plugins.map((plugin: any) => plugin.getState(editor.state));
    return { anchors: states.find((state: any) => Array.isArray(state?.anchors))?.anchors, bookmarks: states.find((state: any) => Array.isArray(state?.bookmarks))?.bookmarks };
  });
  expect((await metadata()).bookmarks).toHaveLength(0);
  expect((await metadata()).anchors[0].deleted).toBe(true);
  await page.getByRole("button", { name: "第 2 块操作", exact: true }).click();
  await page.getByRole("menu", { name: "第 2 块", exact: true }).getByRole("menuitem", { name: "在本块后粘贴块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["second", "third", "first"]);
  const moved = await metadata();
  expect(moved.bookmarks[0].position).toBe(16);
  expect(moved.anchors[0]).toMatchObject({ from: 15, to: 22, deleted: false });
  await root.evaluate(element => (element as any).editor.commands.undo());
  await expect(root.locator(":scope > p")).toHaveText(["second", "third"]);
  expect((await metadata()).bookmarks).toHaveLength(0);
  expect((await metadata()).anchors[0].deleted).toBe(true);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
  expect((await metadata()).bookmarks[0].position).toBe(1);
  expect((await metadata()).anchors[0].deleted).toBeFalsy();
  await root.evaluate(element => { const editor = (element as any).editor; editor.commands.redo(); editor.commands.redo(); });
  await expect(root.locator(":scope > p")).toHaveText(["second", "third", "first"]);
  expect(await metadata()).toEqual(moved);
});

test("剪贴板失败或异步期间正文变化，不删除原块也不插入过期内容", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    write: async () => { throw new Error("denied"); }, readText: async () => { throw new Error("denied"); },
  } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "剪切此块", exact: true }).click();
  await expect(page.getByText("剪切失败，原块已保留，请重试", { exact: true })).toBeVisible();
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块前粘贴块", exact: true }).click();
  await expect(page.getByText("粘贴块失败，请检查剪贴板权限后重试", { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    readText: () => new Promise(resolve => { (window as any).resolveBlockRead = resolve; }),
  } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块后粘贴块", exact: true }).click();
  await root.evaluate(element => (element as any).editor.commands.insertContentAt(1, "changed "));
  await page.evaluate(() => (window as any).resolveBlockRead("# stale"));
  await expect(page.getByText("正文状态已变化，请重新粘贴", { exact: true })).toBeVisible();
  await expect(root.locator(":scope > p")).toHaveText(["changed first", "second", "third"]);
  await expect(root.locator("h1")).toHaveCount(0);
});

test("异步剪切期间切换只读，复制成功也保留原块", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    write: () => new Promise(resolve => { (window as any).resolveBlockWrite = resolve; }),
  } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "剪切此块", exact: true }).click();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.evaluate(() => (window as any).resolveBlockWrite());
  await expect(page.getByText("已复制；正文状态已变化，未删除原块", { exact: true })).toBeVisible();
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
  await open(page);
  for (const name of ["清除文字样式", "剪切此块", "在本块前粘贴块", "在本块后粘贴块"]) {
    await expect(menu(page).getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  }
});

test("异步粘贴期间首页往返，驻留文档不接受先前页面的粘贴请求", async ({ page }) => {
  await setup(page, false, false, true);
  const root = page.locator(".ProseMirror:visible");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    readText: () => new Promise(resolve => { (window as any).resolveBlockRead = resolve; }),
  } }));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块前粘贴块", exact: true }).click();
  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await page.evaluate(() => (window as any).resolveBlockRead("# stale"));
  await expect(page.getByText("正文状态已变化，请重新粘贴", { exact: true })).toBeVisible();
  await expect(root.locator(":scope > p")).toHaveText(["first", "second", "third"]);
});

test("剪切重复内容块时引用不会跳到副本，第二次粘贴也不夺取原引用", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  await root.evaluate(element => {
    const editor = (element as any).editor;
    editor.commands.setContent({ type: "doc", content: ["same", "same", "tail"].map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) }, true);
    const plugin = editor.state.plugins.find((plugin: any) => Array.isArray(plugin.getState(editor.state)?.anchors));
    editor.view.dispatch(editor.state.tr.setMeta(plugin, { id: "original", kind: "block", from: 0, to: 6, preview: "same" }).setMeta("addToHistory", false));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      write: async (items: ClipboardItem[]) => { (window as any).cutItems = items; }, read: async () => (window as any).cutItems,
    } });
  });
  const anchor = () => root.evaluate(element => {
    const editor = (element as any).editor;
    return editor.state.plugins.find((plugin: any) => Array.isArray(plugin.getState(editor.state)?.anchors)).getState(editor.state).anchors[0];
  });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "剪切此块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["same", "tail"]);
  expect((await anchor()).deleted).toBe(true);
  await page.getByRole("button", { name: "第 2 块操作", exact: true }).click();
  await page.getByRole("menu", { name: "第 2 块", exact: true }).getByRole("menuitem", { name: "在本块后粘贴块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["same", "tail", "same"]);
  expect(await anchor()).toMatchObject({ from: 12, to: 18, deleted: false });
  await open(page);
  await menu(page).getByRole("menuitem", { name: "在本块前粘贴块", exact: true }).click();
  await expect(root.locator(":scope > p")).toHaveText(["same", "same", "tail", "same"]);
  expect(await anchor()).toMatchObject({ from: 18, to: 24, deleted: false });
});


test("分组菜单整块排版保留其它块、选区与单步撤销", async ({ page }) => {
  await setup(page);
  const root = page.locator(".ProseMirror:visible");
  const selection = await root.evaluate(element => (element as any).editor.state.selection.from);
  await expect(page.getByRole("button", { name: "块级操作", exact: true })).toHaveCount(0);
  await open(page);
  await expect(menu(page).locator(".block-action-menu-group")).toHaveText(["复制与引用", "阅读与导航", "文字样式", "编辑与结构", "选择", "剪切与删除"]);
  await menu(page).getByRole("menuitem", { name: "粗体", exact: true }).click();
  await expect(root.locator(":scope > p").first().locator("strong")).toHaveText("first");
  expect(await root.evaluate(element => (element as any).editor.state.selection.from)).toBe(selection);
  await expect(root.locator(":scope > p").nth(1).locator("strong")).toHaveCount(0);
  await root.evaluate(element => (element as any).editor.commands.undo());
  await expect(root.locator("strong")).toHaveCount(0);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "斜体", exact: true }).click();
  await expect(root.locator(":scope > p").first().locator("em")).toHaveText("first");
  await open(page);
  await menu(page).getByRole("menuitem", { name: "文字字号", exact: false }).click();
  await menu(page).getByRole("menuitem", { name: "24px", exact: true }).click();
  await open(page);
  await menu(page).getByRole("menuitem", { name: "文字颜色", exact: false }).click();
  await menu(page).getByRole("menuitem", { name: "默认颜色", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(menu(page).getByLabel("自定义颜色", { exact: true })).toBeFocused();
  await menu(page).getByLabel("自定义颜色", { exact: true }).fill("#247f7b");
  await menu(page).getByRole("menuitem", { name: "应用颜色", exact: true }).click();
  const marks = await root.evaluate(element => (element as any).editor.state.doc.child(0).firstChild.marks.map((mark: any) => ({ name: mark.type.name, attrs: mark.attrs })));
  expect(marks).toEqual(expect.arrayContaining([{ name: "textStyle", attrs: { color: "#247f7b", fontSize: "24" } }, { name: "italic", attrs: {} }]));
  await open(page);
  await menu(page).getByRole("menuitem", { name: "文字颜色", exact: false }).click();
  await menu(page).getByRole("menuitem", { name: "默认颜色", exact: true }).click();
  expect(await root.evaluate(element => (element as any).editor.state.doc.child(0).firstChild.marks.find((mark: any) => mark.type.name === "textStyle").attrs)).toEqual({ color: null, fontSize: "24" });
});

for (const [readonly, virtual] of [[false, false], [true, false], [true, true]]) test(`隐藏块号时标题栏复用菜单，readonly=${readonly}，virtual=${virtual}`, async ({ page }) => {
  await setup(page, readonly, virtual, false, false);
  const button = page.getByRole("button", { name: "块级操作", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  const popup = page.locator(".block-action-menu");
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("menuitem", { name: "复制 Markdown", exact: true })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "块级操作" })).toHaveCount(0);
  if (readonly) await expect(popup.getByRole("menuitem", { name: "粗体", exact: true })).toHaveCount(0);
  else {
    await expect(popup).toHaveAttribute("aria-label", "第 3 块");
    await popup.getByRole("menuitem", { name: "粗体", exact: true }).click();
    await expect(page.locator(".ProseMirror:visible > p").nth(2).locator("strong")).toHaveText("third");
    await button.click();
  }
  await button.click();
  await expect(popup).toHaveCount(0);
});


test("子菜单打开后切换块号，重新定位到新块且不沿用旧样式操作", async ({ page }) => {
  await setup(page);
  await open(page);
  await menu(page).getByRole("menuitem", { name: "文字字号", exact: false }).click();
  await page.getByRole("button", { name: "第 2 块操作", exact: true }).click();
  const popup = page.getByRole("menu", { name: "第 2 块", exact: true });
  await expect(popup.locator(".block-action-menu-group")).toHaveCount(6);
  await popup.getByRole("menuitem", { name: "粗体", exact: true }).click();
  await expect(page.locator(".ProseMirror:visible > p").nth(1).locator("strong")).toHaveText("second");
  await expect(page.locator(".ProseMirror:visible > p").first().locator("strong")).toHaveCount(0);
});
