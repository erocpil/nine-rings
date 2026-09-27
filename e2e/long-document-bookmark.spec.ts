import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

for (const input of ["mouse", "touch", "pending-selection"] as const) test(`长文末段 ${input} 点击后立即创建书签保留目标位置`, async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const paragraphs = ["第一段", ...Array.from({ length: 38 }, (_, i) => `用于撑开滚动区的段落 ${i + 2}`), "手机端书签跳转目标"];
    const note = await api.notes.create({
      title: "长文书签创建", date: "2026-09-27",
      content: { ops: paragraphs.flatMap(text => [{ insert: text }, { insert: "\n" }]) },
    });
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.getByPlaceholder("输入文档标题")).toHaveValue("长文书签创建");
  const editor = page.locator(".ProseMirror");
  const target = editor.getByText("手机端书签跳转目标", { exact: true });
  if (input === "pending-selection") {
    const result = await target.evaluate(element => {
      const root = element.closest(".ProseMirror") as HTMLElement & { editor: Editor };
      const editor = root.editor;
      editor.view.dom.focus({ preventScroll: true });
      editor.commands.setTextSelection(1);
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const before = editor.state.selection.head;
      // Invoke the real keymap in the same task, before selectionchange can
      // synchronize the native caret. This makes the race deterministic.
      const event = new KeyboardEvent("keydown", {
        key: "M", code: "KeyM", keyCode: 77, shiftKey: true,
        metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform),
      });
      const handled = editor.view.someProp("handleKeyDown", handler => handler(editor.view, event));
      return { before, handled };
    });
    expect(result).toEqual({ before: 1, handled: true });
  } else {
    if (input === "mouse") await target.click();
    else await target.tap();
    // No polling/diagnostic round-trip between the click and shortcut.
    await page.keyboard.press("ControlOrMeta+Shift+m");
  }
  await editor.getByText("第一段", { exact: true }).click();
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await expect(page.locator(".document-bookmark-jump")).toContainText("手机端书签跳转目标");
});
