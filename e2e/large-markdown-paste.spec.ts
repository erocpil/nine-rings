import { expect, test, type Page, type Locator } from "@playwright/test";

async function openPasteDocument(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.getByTitle("新建文档", { exact: true }).click();
  await page.getByPlaceholder("文档标题...").fill("大段粘贴回归");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue("大段粘贴回归");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  return editor;
}

async function pasteText(editor: Locator, text: string) {
  await editor.evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}

test("大段 Markdown 粘贴保留结构、光标及单步撤销重做", async ({ page }) => {
  test.setTimeout(60000);
  const editor = await openPasteDocument(page);
  const markdown = [
    "# 标题",
    ...Array.from(
      { length: 300 },
      (_, i) => `段落 ${i} 中文 😀 **粗体** 和 *斜体* 以及 \`inline\`。`,
    ),
    "> 引用内容",
    "- 无序一\n- 无序二",
    "1. 有序一\n2. 有序二",
    "```text\n  空格\n\tTab\n```",
    "最后一段",
  ].join("\n\n");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, markdown);
  await expect(editor.locator("strong")).toHaveCount(300);
  await expect(editor.locator("h1")).toHaveText("标题");
  await expect(editor.locator("blockquote")).toContainText("引用内容");
  await expect(editor.locator("ul li")).toHaveCount(2);
  await expect(editor.locator("ol li")).toHaveCount(2);
  await expect(editor.locator("pre code")).toHaveText("  空格\n\tTab");
  const snapshot = () =>
    editor.evaluate((element) => {
      const instance = (
        element as HTMLElement & { editor: import("@tiptap/core").Editor }
      ).editor;
      return {
        doc: instance.getJSON(),
        selection: instance.state.selection.toJSON(),
      };
    });
  const pasted = await snapshot();
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("");
  await page.keyboard.press("Control+Shift+z");
  expect(await snapshot()).toEqual(pasted);
  await page.keyboard.type(" cursor-tail");
  await expect(editor.locator(":scope > p").last()).toHaveText(
    "最后一段 cursor-tail",
  );
  // Selection notifications must cancel stale anchors without forcing layout
  // inside the transaction. Width sampling is coalesced into the next frame.
  const widthReads = await editor.evaluate(async (element) => {
    const instance = (
      element as HTMLElement & { editor: import("@tiptap/core").Editor }
    ).editor;
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    const width = root.clientWidth;
    let reads = 0;
    Object.defineProperty(root, "clientWidth", {
      configurable: true,
      get: () => {
        reads++;
        return width;
      },
    });
    try {
      instance.emit("selectionUpdate", {
        editor: instance,
        transaction: instance.state.tr,
      });
      instance.emit("selectionUpdate", {
        editor: instance,
        transaction: instance.state.tr,
      });
      const synchronous = reads;
      await new Promise(requestAnimationFrame);
      return { synchronous, afterFrame: reads };
    } finally {
      Reflect.deleteProperty(root, "clientWidth");
    }
  });
  expect(widthReads.synchronous).toBe(0);
  expect(widthReads.afterFrame).toBeGreaterThan(0);
});

const largeMarkdown = [
  ...Array.from({ length: 200 }, (_, index) => [
    `## 第 ${index} 节`,
    [`段落 ${index} **粗体** 中文 English 😀`, ...Array(3).fill("技术说明与续行。".repeat(20))].join("\n"),
    ["```javascript", "", `const value${index} = 42;`, `console.log(value${index});`, "", "// 末尾", "```"].join("\n"),
    Array.from({ length: 4 }, (_, item) => `- 第 ${index} 节项目 ${item}`).join("\n"),
    Array.from({ length: 4 }, (_, line) => `> 第 ${index} 节引用 ${line}`).join("\n"),
  ]).flat(),
  "```text\n```",
  "最后一段",
].join("\n\n");

for (const entry of ["原生", "工具栏"] as const) {
  test(`${entry}粘贴约 1000 块、5000 行 Markdown，包含空代码块和前导空行`, async ({ page }) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const editor = await openPasteDocument(page);
    expect(largeMarkdown.split("\n").length).toBeGreaterThanOrEqual(5000);
    if (entry === "原生") await pasteText(editor, largeMarkdown);
    else {
      await page.evaluate(text => {
        Object.defineProperty(navigator.clipboard, "read", { configurable: true, value: async () => [{
          types: ["text/plain"], getType: async () => new Blob([text], { type: "text/plain" }),
        }] });
      }, largeMarkdown);
      await page.getByTitle("粘贴 (Ctrl+V)", { exact: true }).click();
    }
    await expect(page.getByText("已按 Markdown 格式化", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(editor.locator(":scope > h2")).toHaveCount(200);
    await expect(editor.locator("pre code")).toHaveCount(201);
    await expect(editor.locator("ul li")).toHaveCount(800);
    await expect(editor.locator("blockquote")).toHaveCount(200);
    // Check every code block, including the empty one, against the original source.
    expect(await editor.locator("pre code").allTextContents()).toEqual([
      ...Array.from({ length: 200 }, (_, i) => `\nconst value${i} = 42;\nconsole.log(value${i});\n\n// 末尾`), "",
    ]);
    const snapshot = () => editor.evaluate(element => {
      const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      instance.state.doc.check();
      return { doc: instance.getJSON(), selection: instance.state.selection.toJSON() };
    });
    const pasted = await snapshot();
    expect(pasted.doc.content).toHaveLength(1002);
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveText("");
    await page.keyboard.press("Control+Shift+z");
    expect(await snapshot()).toEqual(pasted);
    await page.keyboard.type(" tail");
    await expect(editor.locator(":scope > p").last()).toHaveText("最后一段 tail");
    // Exercise the real autosave, then reopen from storage rather than the session cache.
    await expect.poll(() => page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const note = await api.notes.get(localStorage.getItem("nr:lastNote"));
      return JSON.stringify(note.content).includes("最后一段 tail");
    }), { timeout: 10000 }).toBe(true);
    await page.reload();
    await expect(page.locator(".note-title")).toHaveValue("大段粘贴回归", { timeout: 25000 });
    await expect(editor.locator("pre code")).toHaveCount(201);
    await expect(editor.locator("pre code").first()).toHaveText("\nconst value0 = 42;\nconsole.log(value0);\n\n// 末尾", { useInnerText: false });
    await expect(editor.locator(":scope > p").last()).toHaveText("最后一段 tail");
    expect(errors).toEqual([]);
  });
}

for (const action of ["输入", "移动光标", "切换文档"] as const) {
  test(`后台解析期间${action}不会误写粘贴内容`, async ({ page }) => {
    await page.addInitScript(() => {
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, options) {
        if (message?.task === "markdown-to-prosemirror") {
          Object.assign(window, { releaseMarkdown: () => send.call(this, message, options) });
          this.addEventListener("message", event => {
            if (event.data.id === message.id) Object.assign(window, { markdownDelivered: true });
          });
          return;
        }
        send.call(this, message, options);
      };
    });
    const editor = await openPasteDocument(page);
    await page.keyboard.type("Original");
    await pasteText(editor, largeMarkdown);
    await expect(page.getByText("正在粘贴 Markdown…", { exact: true })).toBeVisible();
    if (action === "输入") await page.keyboard.type(" typed");
    else if (action === "移动光标") await page.keyboard.press("ArrowLeft");
    else {
      await page.getByTitle("新建文档", { exact: true }).click();
      await page.getByPlaceholder("文档标题...").fill("其他文档");
      await page.getByRole("button", { name: "创建", exact: true }).click();
      await expect(page.locator(".note-title")).toHaveValue("其他文档");
      await editor.click();
      await editor.pressSequentially("另一篇正文");
    }
    await page.evaluate(() => (window as unknown as { releaseMarkdown: () => void }).releaseMarkdown());
    await expect.poll(() => page.evaluate(() => (window as unknown as { markdownDelivered: boolean }).markdownDelivered)).toBe(true);
    if (action !== "切换文档") await expect(page.getByText("正文或光标位置已变化，请重新粘贴", { exact: true })).toBeVisible();
    await expect(editor).toHaveText(action === "输入" ? "Original typed" : action === "移动光标" ? "Original" : "另一篇正文");
  });
}

async function simulateInvalidMarkdownResult(page: Page) {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      if (message?.task === "markdown-to-prosemirror") {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
          id: message.id, result: { type: "doc", content: [{ type: "unsupportedMarkdownBlock" }] },
        } })));
        return;
      }
      send.call(this, message, options);
    };
  });
}

const recoverableSource = "\r\n  # 原始 Markdown\r\n" + "  **行内格式**\t内容\r\n".repeat(510) + "  末尾  \r\n";

test("粘贴失败显示实际原因，关闭提示不会修改正文", async ({ page }) => {
  await simulateInvalidMarkdownResult(page);
  const editor = await openPasteDocument(page);
  await page.keyboard.type("Original");
  await pasteText(editor, recoverableSource);
  await expect(page.getByText("Markdown 粘贴未完成", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("Original");
  await page.getByText("查看失败原因", { exact: true }).click();
  await expect(page.locator(".markdown-paste-details pre")).toContainText("校验第 1 块（unsupportedMarkdownBlock）");
  await expect(page.locator(".markdown-paste-details pre")).toContainText("Unknown node type");
  await page.getByRole("button", { name: "关闭粘贴提示" }).click();
  await expect(page.locator(".markdown-paste-status")).toHaveCount(0);
  await expect(editor).toHaveText("Original");
});

test("失败后按纯文本粘贴保留全部空行、缩进和尾部空格，可单步撤销", async ({ page }) => {
  await simulateInvalidMarkdownResult(page);
  const editor = await openPasteDocument(page);
  await page.keyboard.type("Original");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setTextSelection({ from: 1, to: instance.state.doc.content.size - 1 });
  });
  await pasteText(editor, recoverableSource);
  await expect(page.getByText("Markdown 粘贴未完成", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("Original");
  await page.getByRole("button", { name: "按纯文本粘贴", exact: true }).click();
  await expect(page.getByText("已按纯文本粘贴", { exact: true })).toBeVisible();
  const text = await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    return instance.state.doc.textBetween(0, instance.state.doc.content.size, "\n", "\n");
  });
  expect(text).toBe(recoverableSource.replace(/\r\n/g, "\n"));
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("Original");
});

test("失败后继续输入，再点纯文本恢复不会覆盖新正文", async ({ page }) => {
  await simulateInvalidMarkdownResult(page);
  const editor = await openPasteDocument(page);
  await page.keyboard.type("Original");
  await pasteText(editor, recoverableSource);
  await expect(page.getByText("Markdown 粘贴未完成", { exact: true })).toBeVisible();
  await page.keyboard.type(" typed");
  await page.getByRole("button", { name: "按纯文本粘贴", exact: true }).click();
  await expect(page.getByText("正文或光标位置已变化，请重新粘贴", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("Original typed");
  await page.getByRole("button", { name: "关闭粘贴提示" }).click();
  await expect(page.locator(".markdown-paste-status")).toHaveCount(0);
});

test("取消后台粘贴后，稍晚返回的结果不会再插入", async ({ page }) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      if (message?.task === "markdown-to-prosemirror") {
        Object.assign(window, { releaseMarkdown: () => send.call(this, message, options) });
        this.addEventListener("message", event => {
          if (event.data.id === message.id) Object.assign(window, { markdownDelivered: true });
        });
        return;
      }
      send.call(this, message, options);
    };
  });
  const editor = await openPasteDocument(page);
  await page.keyboard.type("Original");
  await pasteText(editor, largeMarkdown);
  await page.getByRole("button", { name: "取消粘贴" }).click();
  await expect(page.locator(".markdown-paste-status")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { releaseMarkdown: () => void }).releaseMarkdown());
  await expect.poll(() => page.evaluate(() => (window as unknown as { markdownDelivered: boolean }).markdownDelivered)).toBe(true);
  await expect(editor).toHaveText("Original");
  await expect(page.locator(".markdown-paste-status")).toHaveCount(0);
});
