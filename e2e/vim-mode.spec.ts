import { expect, test } from "@playwright/test";

async function enableVimMode(page: import("@playwright/test").Page) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
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
  await page.keyboard.press("Control+i");
  await expect(editor.locator("em")).toHaveCount(0);
  await page.keyboard.press("Control+p");
  await expect(page.locator(".quick-switcher-overlay")).toHaveCount(0);
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

test("Vim Ctrl+F/B 按可见编辑区翻页并同步移动光标", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", Array.from(
      { length: 48 },
      (_, index) => `## 章节 ${index + 1}\n\n第 ${index + 1} 节正文`,
    ).join("\n\n"));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor.locator("h2")).toHaveCount(48);
  await enableVimMode(page);

  const scrollRoot = page.locator(".note-editor-scroll");
  await scrollRoot.evaluate((element) => { element.scrollTop = 0; });
  await editor.locator("h2").first().click();
  await page.keyboard.press("0");
  const cursorBlockIndex = () => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    const block = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest(".ProseMirror > *");
    return block?.parentElement ? Array.from(block.parentElement.children).indexOf(block) : -1;
  });
  const initialIndex = await cursorBlockIndex();

  await page.keyboard.press("Control+e");
  await expect.poll(() => scrollRoot.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const lineScroll = await scrollRoot.evaluate((element) => element.scrollTop);
  await expect.poll(cursorBlockIndex).toBe(initialIndex);
  await page.keyboard.press("Control+y");
  await expect.poll(() => scrollRoot.evaluate((element) => element.scrollTop)).toBeLessThan(lineScroll);

  await page.keyboard.press("Control+d");
  await expect.poll(cursorBlockIndex).toBeGreaterThan(initialIndex);
  const halfPageIndex = await cursorBlockIndex();
  await page.keyboard.press("Control+u");
  await expect.poll(cursorBlockIndex).toBeLessThan(halfPageIndex);
  await scrollRoot.evaluate((element) => { element.scrollTop = 0; });
  await editor.locator("h2").first().click();
  await page.keyboard.press("0");

  await page.keyboard.press("Control+f");
  await expect(page.locator(".editor-find-bar")).toHaveCount(0);
  await expect.poll(() => scrollRoot.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(cursorBlockIndex).toBeGreaterThan(initialIndex);
  const forwardIndex = await cursorBlockIndex();
  const forwardScroll = await scrollRoot.evaluate((element) => element.scrollTop);

  await page.keyboard.press("Control+b");
  await expect.poll(cursorBlockIndex).toBeLessThan(forwardIndex);
  await expect.poll(() => scrollRoot.evaluate((element) => element.scrollTop)).toBeLessThan(forwardScroll);
});

test("Vim Normal 模式用 Space 折叠标题，移动跳过隐藏章节", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 第一章\n\n第一章正文\n\n## 第一节\n\n第一节正文\n\n# 第二章\n\n第二章正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await enableVimMode(page);

  await editor.locator("h1").first().click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("0");
  await expect.poll(() => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("h1")?.textContent ?? "";
  })).toBe("第一章");
  await page.keyboard.press("Space");
  await expect(editor.getByText("第一章正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第一节", { exact: true })).toBeHidden();

  const currentTextBlock = () => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor instanceof Element ? anchor : anchor?.parentElement)
      ?.closest("p, h1, h2, h3, h4, h5, h6")?.textContent ?? "";
  });
  await page.keyboard.press("j");
  await expect.poll(currentTextBlock).toBe("第二章");
  await page.keyboard.press("k");
  await expect.poll(currentTextBlock).toBe("第一章");
  await page.keyboard.press("Space");
  await expect(editor.getByText("第一章正文", { exact: true })).toBeVisible();
  await expect(editor.getByText("第一节", { exact: true })).toBeVisible();
});

test("Vim 块光标不改变中西文边界间距", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSupports = CSS.supports.bind(CSS);
    Object.defineProperty(CSS, "supports", {
      configurable: true,
      value: (property: string, value?: string) => property === "text-autospace"
        ? true
        : value === undefined
          ? originalSupports(property)
          : originalSupports(property, value),
    });
  });
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.fill("TX descriptor发布后");
  await enableVimMode(page);

  await editor.click();
  await page.keyboard.press("0");
  await page.keyboard.press("w");
  const cjkBoundaryGap = () => editor.locator("p").evaluate((paragraph) => {
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) throw new Error("expected one text node");
    const boundary = text.data.indexOf("r发");
    const latin = document.createRange();
    latin.setStart(text, boundary);
    latin.setEnd(text, boundary + 1);
    const han = document.createRange();
    han.setStart(text, boundary + 1);
    han.setEnd(text, boundary + 2);
    return han.getBoundingClientRect().left - latin.getBoundingClientRect().right;
  });
  const gapBefore = await cjkBoundaryGap();

  await page.keyboard.press("w");
  await expect(editor.locator(".vim-normal-caret")).toHaveCount(0);
  await expect(page.locator("body > .vim-normal-caret")).toBeVisible();
  await expect.poll(cjkBoundaryGap).toBeCloseTo(gapBefore, 1);
  await expect(editor.locator("p")).toHaveText("TX descriptor发布后");
});

test("Vim 在鼠标选区和右键菜单操作后保持可用", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.fill("alpha beta gamma");
  await enableVimMode(page);

  await editor.getByText("alpha beta gamma", { exact: true }).dblclick({ position: { x: 55, y: 8 } });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
  await page.keyboard.press("h");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await expect(page.locator("body > .vim-normal-caret")).toBeVisible();

  await editor.getByText("alpha beta gamma", { exact: true }).dblclick({ position: { x: 55, y: 8 } });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);
  await editor.click({ button: "right" });
  const menu = page.locator(".editor-context-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "复制" }).click();
  await expect(menu).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.press("l");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  await expect(page.locator("body > .vim-normal-caret")).toBeVisible();
});

test("只读文档保留 Vim Normal 导航并屏蔽写命令", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.fill("readonly vim");
  await enableVimMode(page);
  await editor.click();
  await page.keyboard.press("0");

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".editor-vim-status")).toHaveText("NORMAL");

  await editor.click({ position: { x: 8, y: 8 } });
  await expect(editor).toBeFocused();
  await page.keyboard.press("0");
  await page.keyboard.press("l");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset ?? -1)).toBe(1);
  await expect(page.locator("body > .vim-normal-caret")).toBeVisible();

  await page.keyboard.press("x");
  await page.keyboard.press("i");
  await page.keyboard.type("blocked");
  await expect(editor).toContainText("readonly vim");
  await expect(editor).not.toContainText("blocked");
  await expect(page.locator(".editor-vim-status")).toHaveText("NORMAL");
});
