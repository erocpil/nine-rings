import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("大文档切换只读保留正文、光标、代码控件和撤销记录", async ({ page }) => {
  test.setTimeout(60000);
  await createBlankDocument(page);
  const markdown = process.env.MARKDOWN_PASTE_FIXTURE
    ? await readFile(process.env.MARKDOWN_PASTE_FIXTURE, "utf8")
    : Array.from({ length: 150 }, (_, index) => [
      `## 章节 ${index}`,
      ...Array.from({ length: 4 }, (_, paragraph) => `段落 ${index}-${paragraph}：**大文档**的只读切换应保留正文和光标位置。`),
      `\`\`\`typescript\nconst section = ${index};\nconsole.log(section);\n\`\`\``,
    ].join("\n\n")).join("\n\n");
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, markdown);
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.doc.childCount)).toBeGreaterThanOrEqual(900);
  await expect(page.locator(".save-status-saved")).toBeVisible();
  // Insert a separate undo event, then exercise real UI mode changes.
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setTextSelection(5);
    instance.commands.insertContent("MODE_TRANSITION_MARKER");
  });
  await expect(page.locator(".save-status-saved")).toBeVisible();
  const snapshot = await editor.evaluateHandle(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    return { element, instance, doc: instance.state.doc, selection: instance.state.selection,
      language: element.querySelector(".code-block-language") };
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(editor.getByLabel("代码语言").first()).toBeVisible();
  await expect(editor.getByLabel("代码语言").first()).toBeDisabled();
  await editor.evaluate(element => {
    const data = new DataTransfer();
    data.setData("text/plain", "READONLY_MUST_NOT_CHANGE");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor.getByLabel("代码语言").first()).toBeVisible();
  expect(await page.evaluate(before => {
    const element = document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
    return { sameEditor: element === before.element && element.editor === before.instance,
      sameDocument: element.editor.state.doc === before.doc,
      sameSelection: element.editor.state.selection.eq(before.selection),
      sameLanguageControl: element.querySelector(".code-block-language") === before.language };
  }, snapshot)).toEqual({ sameEditor: true, sameDocument: true, sameSelection: true, sameLanguageControl: true });
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.undo();
  });
  await expect(editor).not.toContainText("MODE_TRANSITION_MARKER");
  await expect(editor.locator("pre")).toHaveCount(markdown.match(/^```\w*/gm)!.length / 2);
  await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.redo());
  await expect(editor).toContainText("MODE_TRANSITION_MARKER");
  await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.view.focus());
  await page.keyboard.type("EDIT_AFTER_SWITCH");
  await expect(editor).toContainText("MODE_TRANSITION_MARKEREDIT_AFTER_SWITCH");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  await page.reload();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toContainText("MODE_TRANSITION_MARKEREDIT_AFTER_SWITCH");
  await expect(editor).not.toContainText("READONLY_MUST_NOT_CHANGE");
  const language = editor.getByLabel("代码语言").first();
  await language.focus();
  await language.selectOption("python");
  await expect(language).toHaveValue("python");
  await expect.poll(() => editor.evaluate(element => {
    let language: unknown;
    (element as HTMLElement & { editor: Editor }).editor.state.doc.descendants(node => {
      if (node.type.name === "codeBlock" && language === undefined) language = node.attrs.language;
    });
    return language;
  })).toBe("python");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
});
