import { expect, test, type Page } from "@playwright/test";

async function displayPreferences(page: Page, values: { whitespace?: "all"; tabSize?: number; fontSize?: number; height?: number }) {
  await page.evaluate(async values => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const settings = await load("/src/lib/block-display-settings.ts") as typeof import("../src/lib/block-display-settings");
    const { height, ...preferences } = values;
    settings.saveBlockWorkspacePreferences(preferences);
    if (height) settings.setCodeBlockHeightPercent(height);
  }, values);
}

async function fixture(page: Page, readonly = false, secondCode = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15000 });
  const id = await page.evaluate(async ({ readonly, secondCode }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { mdToDelta } = await load("/src/lib/md-parser.ts") as typeof import("../src/lib/md-parser");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.create({ title: "块工作区测试", date: useNotesStore.getState().currentDate, content: mdToDelta("前文\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```\n\n> 引用第一段\n>\n> 引用第二段\n\n后文" + (secondCode ? "\n\n```js\nconst second = 2;\n```" : "")) });
    if (readonly) await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote((await api.notes.get(note.id))!);
    return note.id;
  }, { readonly, secondCode });
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
  await displayPreferences(page, { whitespace: "all", tabSize: 8 });
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await expect(dialog.locator(".workspace-ws-space").first()).toBeVisible();
  await expect(dialog.locator(".workspace-ws-newline")).toHaveCount(1);
  await expect(dialog.locator(".ProseMirror")).toHaveCSS("tab-size", "8");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async (items: ClipboardItem[]) => {
    document.documentElement.dataset.blockCopy = await (await items[0].getType("text/plain")).text();
  } }));
  const contentBeforeCopy = await dialog.locator(".block-workspace-body").boundingBox();
  await dialog.getByRole("button", { name: "复制块", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-block-copy", "const answer = 42;\nconsole.log(answer);");
  await expect(dialog.getByText("已复制块（保留格式）")).toBeVisible();
  expect(await dialog.locator(".block-workspace-body").boundingBox()).toEqual(contentBeforeCopy);
  await expect(dialog.locator(".copy-block-feedback")).toHaveCSS("position", "absolute");
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
  await expect(dialog.getByRole("button", { name: "块显示设置" })).toHaveCount(0);
  await expect(dialog.locator(".workspace-ws-space").first()).toBeVisible();
});

test("长代码正文限高而弹层保持单一纵向滚动区", async ({ page }) => {
  await fixture(page);
  await displayPreferences(page, { height: 40 });
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.locator("pre code").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(Array.from({ length: 150 }, (_, i) => `line${i}`).join("\n"));
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await dialog.getByRole("button", { name: "块内查找" }).click();
  const sourceInner = page.locator(".note-editor .code-block-inner");
  await expect.poll(async () => (await sourceInner.boundingBox())!.height).toBeLessThanOrEqual(321);
  await expect(dialog.locator(".code-block-inner")).toHaveCSS("max-height", "none");
  expect(await dialog.locator(".block-workspace-body").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await dialog.locator("pre").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await dialog.getByLabel("跳转代码行").fill("140");
  await dialog.getByRole("button", { name: "跳转", exact: true }).click();
  expect(await dialog.locator(".block-workspace-body").evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
});

test("同类块切换保留编辑且保存失败不关闭弹层", async ({ page }) => {
  await fixture(page, false, true);
  await page.getByRole("button", { name: "放大阅读代码块" }).first().click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "下一个代码块", exact: true }).click();
  await expect(dialog.locator("pre code")).toHaveText("const second = 2;");
  await expect(dialog.getByRole("button", { name: "下一个代码块", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const update = api.notes.update;
    document.documentElement.dataset.failBlockSave = "true";
    api.notes.update = (id, changes) => document.documentElement.dataset.failBlockSave === "true" && changes.content ? Promise.reject(new Error("test: storage unavailable")) : update(id, changes);
  });
  await dialog.locator("pre code").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("const second = 200;");
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("保存失败");
  await page.evaluate(() => delete document.documentElement.dataset.failBlockSave);
  await dialog.getByRole("button", { name: "上一个代码块", exact: true }).click();
  await expect(dialog.locator("pre code")).toContainText("const answer = 42;");
  await expect(page.locator(".note-editor .ProseMirror pre code").last()).toHaveText("const second = 200;");
});

test("实验只读渲染可进入块工作区", async ({ page }) => {
  await fixture(page, true);
  await page.evaluate(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
  });
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  const dialog = page.getByRole("dialog", { name: "引用块工作区" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("引用第一段");
  await expect(dialog.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
});

test("外部替换目标块后旧弹层失效，不覆盖新正文", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    // Exercise a source transaction (e.g. restoring an external revision),
    // not a props-only autosave acknowledgement which intentionally keeps DOM.
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "外部替换的新正文" }] }] }, true);
  });
  await expect(page.getByRole("dialog", { name: "代码块工作区" })).toHaveCount(0);
  await expect(page.locator(".note-editor .ProseMirror")).toContainText("外部替换的新正文");
});

test("引用编辑复用格式工具，显示偏好在重新打开后保留", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  const dialog = page.getByRole("dialog", { name: "引用块工作区" });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.locator(".ProseMirror p").first().click();
  await dialog.getByLabel("段落样式").selectOption("2");
  await expect(dialog.locator("h2")).toHaveText("引用第一段");
  await expect(page.locator(".note-editor blockquote h2")).toHaveText("引用第一段");
  await dialog.getByRole("button", { name: "增加缩进", exact: true }).click();
  await expect(page.locator(".note-editor blockquote")).toHaveAttribute("data-indent", "1");
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭块工作区" }).click();
  await displayPreferences(page, { tabSize: 8, fontSize: 20 });
  await page.getByRole("button", { name: "放大阅读引用块" }).click();
  await expect(dialog.locator(".ProseMirror")).toHaveCSS("tab-size", "8");
  await expect(dialog.locator(".ProseMirror")).toHaveCSS("font-size", "20px");
});

test("弹层剪贴板降级在模态内部选择纯文本", async ({ page }) => {
  await fixture(page, true);
  await displayPreferences(page, { whitespace: "all" });
  await page.getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async () => { throw new Error("denied"); } });
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new Error("denied"); } });
    document.execCommand = command => {
      const input = document.activeElement;
      if (command !== "copy" || !(input instanceof HTMLTextAreaElement) || !input.closest("dialog[open]")) return false;
      document.documentElement.dataset.fallbackCopy = input.value;
      return true;
    };
  });
  await dialog.getByRole("button", { name: "复制块", exact: true }).click();
  await expect(dialog).toContainText("已复制块（纯文本）");
  await expect(page.locator("html")).toHaveAttribute("data-fallback-copy", "const answer = 42;\nconsole.log(answer);");
  await dialog.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-fallback-copy", "const answer = 42;\nconsole.log(answer);");
});

test.describe("触屏块工作区", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });
  test("背景和块空白不关闭，行号开关可用且入口不残留焦点", async ({ page }) => {
    await fixture(page);
    for (const name of ["代码块", "引用块"]) {
      const opener = page.getByRole("button", { name: `放大阅读${name}` });
      await opener.tap();
      const dialog = page.getByRole("dialog", { name: `${name}工作区` });
      await expect(dialog).toBeVisible();
      await expect(opener).not.toBeFocused();
      expect((await dialog.locator(".block-workspace-header").boundingBox())!.height).toBeLessThanOrEqual(40);
      await page.mouse.click(1, 300);
      await expect(dialog).toBeVisible();
      const body = (await dialog.locator(".block-workspace-body").boundingBox())!;
      await page.mouse.click(body.x + body.width / 2, body.y + body.height - 10);
      await expect(dialog).toBeVisible();
      if (name === "代码块") {
        await dialog.getByRole("button", { name: "显示代码行号", exact: true }).click();
        await expect(dialog.locator(".code-block-gutter")).toBeVisible();
        await dialog.getByRole("button", { name: "隐藏代码行号", exact: true }).click();
        await expect(dialog.locator(".code-block-gutter")).toBeHidden();
      }
      await dialog.getByRole("button", { name: "编辑", exact: true }).click();
      await page.mouse.click(1, 300);
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).not.toBeFocused();
    }
  });
  test("键盘压缩可视区域后关闭按钮仍可点击", async ({ page }) => {
    await fixture(page);
    await page.getByRole("button", { name: "放大阅读代码块" }).click();
    const dialog = page.getByRole("dialog", { name: "代码块工作区" });
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await dialog.locator("pre code").click();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 260 });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    const close = dialog.getByRole("button", { name: "关闭块工作区" });
    await expect.poll(async () => {
      const bounds = (await close.boundingBox())!;
      return bounds.y >= 0 && bounds.y + bounds.height <= 260;
    }).toBe(true);
    expect(await dialog.locator(".block-workspace-body").evaluate(element => element.clientHeight)).toBeGreaterThan(0);
    const bounds = (await dialog.boundingBox())!;
    expect(260 - bounds.y - bounds.height).toBeGreaterThanOrEqual(7);
    await expect(dialog).toHaveCSS("padding-bottom", "8px");
    await page.screenshot({ path: "/tmp/nr-block-workspace-keyboard.png" });
    await close.click();
    await expect(dialog).toHaveCount(0);
  });
});
