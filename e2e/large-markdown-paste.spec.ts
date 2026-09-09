import { expect, test } from "@playwright/test";

test("大段 Markdown 粘贴保留结构、光标及单步撤销重做", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = (await load(
      "/src/lib/api.ts",
    )) as typeof import("../src/lib/api");
    const { useNotesStore } = (await load(
      "/src/stores/useNotesStore.ts",
    )) as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.create({
      title: "大段粘贴回归",
      date: "2026-09-09",
      storagePath: "tests/paste",
      content: { ops: [] },
    });
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.locator(".note-title")).toHaveValue("大段粘贴回归");
  const editor = page.locator(".ProseMirror");
  await editor.click();
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
