import { test, expect } from "@playwright/test";
import type { Editor, JSONContent } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const input of ["keyboard", "beforeinput"] as const) {
  for (const structure of ["plain", "adjacent", "code", "quote"] as const) {
    test(`15 项列表回车、删除和退出：${structure}/${input}`, async ({ page }) => {
      await createBlankDocument(page);
      const root = page.locator(".note-editor .ProseMirror");
      await root.evaluate((el, structure) => {
        const editor = (el as HTMLElement & { editor: Editor }).editor;
        const p = (text = ""): JSONContent => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
        const items = Array.from({ length: 15 }, (_, i) => ({ type: "listItem", content: [p(`项目 ${i + 1}`)] }));
        if (structure === "code") items[14].content.push({ type: "codeBlock", content: [{ type: "text", text: "const n = 15" }] }, p());
        if (structure === "quote") items[14].content.push({ type: "blockquote", content: [p("引用内容")] }, p());
        editor.commands.setContent({ type: "doc", content: [
          { type: "orderedList", content: items },
          ...(structure === "adjacent" ? [{ type: "orderedList", attrs: { start: 16 }, content: [{ type: "listItem", content: [p("后续列表")] }] }] : []),
          p("列表之后"),
        ] }, true);
        let target = 0;
        editor.state.doc.firstChild!.descendants((node, pos) => { if (node.type.name === "paragraph") target = pos + 2 + node.content.size; });
        editor.commands.setTextSelection(target);
        editor.view.focus();
      }, structure);
      const enter = async () => {
        if (input === "keyboard") await page.keyboard.press("Enter");
        else await root.evaluate(el => {
          const event = new InputEvent("beforeinput", { inputType: "insertParagraph", bubbles: true, cancelable: true });
          el.dispatchEvent(event);
          if (!event.defaultPrevented) throw new Error("List Enter fell through to native DOM mutation");
        });
      };
      const items = root.locator(":scope > ol").first().locator(":scope > li");
      await enter();
      await expect(items).toHaveCount(16);
      await expect(items.nth(14)).toContainText("项目 15");
      await page.keyboard.type("next");
      for (let i = 0; i < 3; i++) {
        await enter();
        await expect(items).toHaveCount(17);
        await page.keyboard.press("Backspace");
        await expect(items).toHaveCount(16);
      }
      await enter();
      await enter();
      await expect(items).toHaveCount(16);
      await page.keyboard.type("独立正文");
      await expect(root.locator(":scope > p").first()).toHaveText("独立正文");
      await expect(root.locator(":scope > p").last()).toHaveText("列表之后");
      if (structure === "code") await expect(items.nth(14).locator("code")).toHaveText("const n = 15");
      if (structure === "quote") await expect(items.nth(14).locator("blockquote")).toContainText("引用内容");
      if (structure === "adjacent") await expect(root.locator(":scope > ol").nth(1)).toHaveText("后续列表");
      await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 15000 });
      await page.reload();
      await expect(root.locator(":scope > ol").first().locator(":scope > li")).toHaveCount(16);
      await expect(root.locator(":scope > p").first()).toHaveText("独立正文");
      if (structure === "code") await expect(items.nth(14).locator("code")).toHaveText("const n = 15");
      if (structure === "quote") await expect(items.nth(14).locator("blockquote")).toContainText("引用内容");
    });
  }
}

test("源码最后一行可以滚到视口顶部，缩小窗口后仍有尾部留白", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(el => {
    const editor = (el as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: Array.from({ length: 80 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `line ${i}` }] })) }, true);
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  for (const height of [800, 600]) {
    await page.setViewportSize({ width: 1280, height });
    await expect.poll(() => area.evaluate(el => {
      const style = getComputedStyle(el);
      return Math.abs(parseFloat(style.paddingBottom) - (el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.lineHeight)));
    })).toBeLessThan(2);
    const metrics = await area.evaluate((el: HTMLTextAreaElement) => {
      el.scrollTop = el.scrollHeight;
      const style = getComputedStyle(el);
      // WebKit rounds textarea line layout differently from computed line-height.
      // Measure native text extent rather than accumulating fractional CSS pixels.
      const measure = el.cloneNode(false) as HTMLTextAreaElement;
      measure.value = el.value;
      measure.style.cssText = `position:fixed;visibility:hidden;width:${el.clientWidth}px;height:1px;min-height:0;padding:0;border:0;font:${style.font};`;
      document.body.append(measure);
      const lastLine = parseFloat(style.paddingTop) + measure.scrollHeight - parseFloat(style.lineHeight);
      measure.remove();
      return { top: el.scrollTop, lastLine, height: el.clientHeight };
    });
    expect(metrics.height).toBeGreaterThan(200);
    expect(Math.abs(metrics.lastLine - metrics.top)).toBeLessThan(35);
  }
});

for (const nested of [false, true]) {
  test(`空段落残留不阻止退出，撤销重做保留列表内容（嵌套=${nested}）`, async ({ page }) => {
    await createBlankDocument(page);
    const root = page.locator(".note-editor .ProseMirror");
    await root.evaluate((el, nested) => {
      const editor = (el as HTMLElement & { editor: Editor }).editor;
      const paragraph = { type: "paragraph" };
      const list = { type: "orderedList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "最后一项" }] }, paragraph, paragraph,
      ] }] };
      editor.commands.setContent({ type: "doc", content: nested ? [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "父项" }] }, list] }] }] : [list] }, true);
      let pos = 0;
      editor.state.doc.descendants((node, offset) => { if (node.type.name === "paragraph" && node.textContent === "最后一项") pos = offset + 1 + node.content.size; });
      editor.commands.setTextSelection(pos);
      editor.view.focus();
    }, nested);
    await page.keyboard.press("Enter");
    await expect(root.locator("ol > li")).toHaveCount(2);
    const before = await root.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON());
    // Delimit the undo event so the assertion covers exactly the second Enter.
    await root.evaluate(async el => {
      const { closeHistory } = await import("/node_modules/@tiptap/pm/history/dist/index.js");
      const editor = (el as HTMLElement & { editor: Editor }).editor;
      editor.view.dispatch(closeHistory(editor.state.tr));
    });
    await page.keyboard.press("Enter");
    await expect(root.locator("ol > li")).toHaveCount(1);
    if (nested) await expect(root.locator(":scope > ul > li")).toHaveCount(2);
    else await expect(root.locator(":scope > p")).toHaveCount(1);
    await root.evaluate(el => { (el as HTMLElement & { editor: Editor }).editor.commands.undo(); });
    expect(await root.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(before);
    await root.evaluate(el => { (el as HTMLElement & { editor: Editor }).editor.commands.redo(); });
    await expect(root.locator("ol > li")).toHaveCount(1);
    await expect(root).toContainText("最后一项");
  });
}
