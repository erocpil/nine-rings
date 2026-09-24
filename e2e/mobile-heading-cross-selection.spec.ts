import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

test("跨标题选区不包含折叠控件和块号", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "跨标题选择",
      date: useNotesStore.getState().currentDate,
      content: { ops: [{ insert: "First heading\nSecond heading\n" }] },
    });
    useNotesStore.getState().selectNote(note);
  });
  const root = page.locator(".note-editor .ProseMirror");
  await root.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "First heading" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body text" }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Second heading" }] },
      ],
    });
  });

  await expect(root.locator(".editor-fold-host")).toHaveCount(2);
  const result = await root.evaluate((element) => {
    const headings = element.querySelectorAll("h1");
    const firstText = headings[0].lastChild!;
    const secondText = headings[1].lastChild!;
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(secondText, secondText.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const host = headings[0].querySelector<HTMLElement>(".editor-fold-host")!;
    const button = host.querySelector<HTMLElement>("button")!;
    return {
      text: selection.toString().replace(/\n+/g, "\n"),
      headingSelectable: getComputedStyle(headings[0]).webkitUserSelect,
      hostSelectable: getComputedStyle(host).webkitUserSelect,
      buttonSelectable: getComputedStyle(button).webkitUserSelect,
    };
  });
  expect(result).toEqual({
    text: "First heading\nBody text\nSecond heading",
    headingSelectable: "text",
    hostSelectable: "none",
    buttonSelectable: "none",
  });

  // The reported case has adjacent headings and a wrapped first title.
  const adjacent = await root.evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    const first = "Part XI. Performance Diagnosis Playbook";
    const second = "第十一部分：性能诊断手册";
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: first }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: second }] },
      ],
    });
    const headings = element.querySelectorAll("h1");
    const range = document.createRange();
    range.setStart(headings[0].lastChild!, 0);
    range.setEnd(headings[1].lastChild!, second.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const firstLineRange = document.createRange();
    firstLineRange.selectNodeContents(headings[0].lastChild!);
    return {
      text: selection.toString().replace(/\n+/g, "\n"),
      foldHostSelectable: getComputedStyle(headings[0].querySelector(".editor-fold-host")!).webkitUserSelect,
      wrapped: [...firstLineRange.getClientRects()].filter((rect) => rect.width > 0).length > 1,
    };
  });
  expect(adjacent).toEqual({
    text: "Part XI. Performance Diagnosis Playbook\n第十一部分：性能诊断手册",
    foldHostSelectable: "none",
    wrapped: true,
  });
});
