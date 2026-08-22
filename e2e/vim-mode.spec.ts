import { expect, test } from "@playwright/test";

async function enableVimMode(page: import("@playwright/test").Page) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器/ }).click();
  const vimField = page.locator(".settings-field").filter({ hasText: "Vim 模式（实验性）" });
  if (!(await vimField.locator('input[type="checkbox"]').isChecked())) {
    await vimField.locator(".settings-toggle").click();
  }
  await expect(vimField.locator('input[type="checkbox"]')).toBeChecked();
  await page.locator(".settings-close").click();
}

test("实验性 Vim 模式可切换 Normal/Insert 并执行基础命令", async ({ page }) => {
  await page.goto("/");

  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.fill("alpha beta");

  await enableVimMode(page);

  const mode = page.locator(".editor-vim-status");
  await expect(mode).toHaveText("NORMAL");

  await editor.click();
  await page.keyboard.press("i");
  await expect(mode).toHaveText("INSERT");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(editor).toContainText("alpha beta!");

  await page.keyboard.press("Escape");
  await expect(mode).toHaveText("NORMAL");
  await page.keyboard.press("Control+f");
  await expect(page.locator(".editor-find-bar")).toHaveCount(0);

  await page.keyboard.press("0");
  await page.keyboard.press("x");
  await expect(editor).toContainText("lpha beta!");

  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect(editor).not.toContainText("lpha beta!");

  await page.keyboard.press("u");
  await expect(editor).toContainText("lpha beta!");
});

test("Vim 词移动区分数字与中文，并逐文本行跨越 HR、列表和表格", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("123中文 alpha");
  await enableVimMode(page);
  await editor.click();
  await page.keyboard.press("0");
  await page.keyboard.press("w");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1)).toBe(3);
  await page.keyboard.press("w");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1)).toBe(6);

  await page.keyboard.press("i");
  await page.keyboard.press("Control+a");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", [
      "第一行",
      "",
      "---",
      "",
      "- 列表一",
      "- 列表二",
      "",
      "| A | B |",
      "|---|---|",
      "| 单元一 | 单元二 |",
      "",
      "最后一行",
    ].join("\n"));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("g");

  const currentTextBlock = () => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor instanceof Element ? anchor : anchor?.parentElement)
      ?.closest("p, h1, h2, h3, h4, h5, h6")?.textContent ?? "";
  });
  await expect.poll(currentTextBlock).toBe("第一行");
  for (const expected of ["列表一", "列表二", "A", "B", "单元一", "单元二", "最后一行"]) {
    await page.keyboard.press("j");
    await expect.poll(currentTextBlock).toBe(expected);
  }
});

test("Vim gj/gk 按视觉换行移动，j/k 仍按逻辑文本行移动", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const longLine = "这是用于验证视觉换行移动的很长一段文字，需要在较窄的编辑区域内自然换成多行显示。";
  await editor.fill(`${longLine}\n第二逻辑行`);
  await page.locator(".editor-content-shell").evaluate((element) => {
    (element as HTMLElement).style.width = "240px";
  });
  await enableVimMode(page);
  await editor.click();
  await page.keyboard.press("g");
  await page.keyboard.press("g");

  const selection = () => page.evaluate(() => {
    const current = window.getSelection();
    const anchor = current?.anchorNode;
    const block = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("p");
    return { text: block?.textContent ?? "", offset: current?.anchorOffset ?? -1 };
  });
  await expect.poll(selection).toEqual({ text: longLine, offset: 0 });
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect.poll(selection).toEqual(expect.objectContaining({ text: longLine }));
  expect((await selection()).offset).toBeGreaterThan(0);

  await page.keyboard.press("j");
  await expect.poll(selection).toEqual(expect.objectContaining({ text: "第二逻辑行" }));
  await page.keyboard.press("k");
  await expect.poll(selection).toEqual(expect.objectContaining({ text: longLine }));
  await page.keyboard.press("g");
  await page.keyboard.press("k");
  await expect.poll(selection).toEqual(expect.objectContaining({ text: longLine }));
});
