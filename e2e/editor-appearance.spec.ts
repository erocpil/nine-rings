import { expect, test } from "@playwright/test";

test("排版设置中的调整即时生效并在重载后保持", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await expect(page.getByText("编辑器排版", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await expect(page.getByRole("dialog", { name: "排版设置" })).toBeVisible();
  await expect(page.getByLabel("编辑器排版预览")).toBeVisible();

  await page.getByLabel("正文字体").selectOption("serif");
  await page.getByRole("button", { name: "增大正文与标题字号" }).click();
  await page.getByRole("button", { name: "增大行距" }).click();
  await page.getByRole("button", { name: "增大正文块间距" }).click();
  await page.getByRole("button", { name: "减小列表层级缩进" }).click();
  await page.getByRole("button", { name: "增大标题上间距" }).click();
  await page.getByRole("button", { name: "减小标题下间距" }).click();
  await page.getByRole("button", { name: "增大列表上间距" }).click();
  await page.getByRole("button", { name: "减小列表下间距" }).click();
  await page.getByLabel("搜索关键字颜色").fill("#33aa77");
  await page.getByRole("button", { name: "应用到编辑器" }).click();

  const app = page.locator(".app");
  await expect.poll(() => app.evaluate((element) => ({
    family: (element as HTMLElement).style.getPropertyValue("--editor-font-family"),
    size: (element as HTMLElement).style.getPropertyValue("--editor-font-size"),
    lineHeight: (element as HTMLElement).style.getPropertyValue("--editor-line-height"),
    blockSpacing: (element as HTMLElement).style.getPropertyValue("--editor-block-spacing"),
    listIndent: (element as HTMLElement).style.getPropertyValue("--editor-list-indent"),
    searchColor: (element as HTMLElement).style.getPropertyValue("--editor-search-highlight"),
    headingTop: (element as HTMLElement).style.getPropertyValue("--editor-heading-margin-top"),
    headingBottom: (element as HTMLElement).style.getPropertyValue("--editor-heading-margin-bottom"),
    listTop: (element as HTMLElement).style.getPropertyValue("--editor-list-margin-top"),
    listBottom: (element as HTMLElement).style.getPropertyValue("--editor-list-margin-bottom"),
  }))).toEqual({
    family: '"Noto Serif SC", "Songti SC", SimSun, serif',
    size: "17px",
    lineHeight: "1.7",
    blockSpacing: "1.05em",
    listIndent: "1.2em",
    searchColor: "#33aa77",
    headingTop: "0.75em",
    headingBottom: "0.3em",
    listTop: "0.3em",
    listBottom: "0.2em",
  });

  await page.getByRole("button", { name: /打开排版设置/ }).click();

  const previewSpacing = await page.getByLabel("编辑器排版预览").evaluate((element) => {
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    const topLevelList = element.querySelector(":scope > ul");
    const nestedList = element.querySelector(":scope > ul ul");
    const topLevelOrderedList = element.querySelector(":scope > ol");
    const nestedOrderedList = element.querySelector(":scope > ol ol");
    const unorderedItem = topLevelList?.querySelector(":scope > li");
    const orderedItem = topLevelOrderedList?.querySelector(":scope > li");
    const firstParagraph = element.querySelector(":scope > h3 + p");
    const secondParagraph = firstParagraph?.nextElementSibling;
    if (!topLevelList || !nestedList || !topLevelOrderedList || !nestedOrderedList || !unorderedItem || !orderedItem || !firstParagraph || !(secondParagraph instanceof HTMLParagraphElement)) {
      throw new Error("appearance preview spacing fixtures not found");
    }
    const firstBox = firstParagraph.getBoundingClientRect();
    const secondBox = secondParagraph.getBoundingClientRect();
    return {
      paragraphGap: (secondBox.top - firstBox.bottom) / fontSize,
      listTop: Number.parseFloat(getComputedStyle(topLevelList).marginTop) / fontSize,
      listBottom: Number.parseFloat(getComputedStyle(topLevelList).marginBottom) / fontSize,
      nestedTop: Number.parseFloat(getComputedStyle(nestedList).marginTop),
      unorderedIndent: Number.parseFloat(getComputedStyle(topLevelList).paddingInlineStart) / fontSize,
      orderedIndent: Number.parseFloat(getComputedStyle(topLevelOrderedList).paddingInlineStart) / fontSize,
      nestedOrderedIndent: Number.parseFloat(getComputedStyle(nestedOrderedList).paddingInlineStart) / fontSize,
      orderedOffset: Number.parseFloat(
        getComputedStyle(topLevelOrderedList).getPropertyValue("--editor-ordered-list-offset"),
      ),
      unorderedMarker: getComputedStyle(unorderedItem, "::before").content,
      orderedMarker: getComputedStyle(orderedItem, "::before").content,
      orderedNativeMarker: getComputedStyle(orderedItem, "::marker").content,
    };
  });
  expect(previewSpacing.paragraphGap).toBeCloseTo(1.05, 2);
  expect(previewSpacing.listTop).toBeCloseTo(0.3, 2);
  expect(previewSpacing.listBottom).toBeCloseTo(0.2, 2);
  expect(previewSpacing.nestedTop).toBe(0);
  expect(previewSpacing.unorderedIndent).toBeCloseTo(1.2, 2);
  expect(previewSpacing.orderedIndent).toBeCloseTo(
    previewSpacing.unorderedIndent + previewSpacing.orderedOffset,
    2,
  );
  expect(previewSpacing.nestedOrderedIndent).toBeCloseTo(previewSpacing.orderedIndent, 2);
  expect(previewSpacing.unorderedMarker).toContain("•");
  expect(previewSpacing.orderedMarker).toContain("counter(list-item)");
  expect(previewSpacing.orderedMarker).not.toContain("•");
  expect(previewSpacing.orderedNativeMarker).toBe('""');

  await page.reload();
  await expect.poll(() => page.locator(".app").evaluate((element) => ({
    size: (element as HTMLElement).style.getPropertyValue("--editor-font-size"),
    lineHeight: (element as HTMLElement).style.getPropertyValue("--editor-line-height"),
    blockSpacing: (element as HTMLElement).style.getPropertyValue("--editor-block-spacing"),
    searchColor: (element as HTMLElement).style.getPropertyValue("--editor-search-highlight"),
    headingTop: (element as HTMLElement).style.getPropertyValue("--editor-heading-margin-top"),
    headingBottom: (element as HTMLElement).style.getPropertyValue("--editor-heading-margin-bottom"),
    listTop: (element as HTMLElement).style.getPropertyValue("--editor-list-margin-top"),
    listBottom: (element as HTMLElement).style.getPropertyValue("--editor-list-margin-bottom"),
  }))).toEqual({ size: "17px", lineHeight: "1.7", blockSpacing: "1.05em", searchColor: "#33aa77", headingTop: "0.75em", headingBottom: "0.3em", listTop: "0.3em", listBottom: "0.2em" });
  await expect(page.locator(".menu-font-size-label")).toHaveText("17");
});

test("中英文自动间距只改变渲染且开关可以持久化", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSupports = CSS.supports.bind(CSS);
    Object.defineProperty(CSS, "supports", {
      configurable: true,
      value: (property: string, value?: string) => property === "text-autospace"
        ? false
        : value === undefined
          ? originalSupports(property)
          : originalSupports(property, value),
    });
  });
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.fill("中文Codex中文，ABC。第3章");

  const noteEditor = page.locator(".note-editor");
  await expect(noteEditor).toHaveClass(/editor-auto-cjk-spacing/);
  await expect(noteEditor).toHaveClass(/editor-cjk-spacing-fallback/);
  await expect(editor.locator("[data-cjk-auto-space=true]")).toHaveCount(3);
  await expect(editor.locator(".cjk-auto-space-before")).toHaveCount(2);
  await expect(editor.locator(".cjk-auto-space-after")).toHaveCount(2);
  await expect(editor).toHaveText("中文Codex中文，ABC。第3章");

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  const toggle = page.getByLabel("中英文自动间距");
  await expect(toggle).toBeChecked();
  await page.locator(".editor-appearance-toggle").click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "应用到编辑器" }).click();
  await expect(noteEditor).not.toHaveClass(/editor-auto-cjk-spacing/);

  await page.reload();
  await expect(page.locator(".note-editor")).not.toHaveClass(/editor-auto-cjk-spacing/);
});

test("Alt-E 聚焦全局搜索而 Ctrl-E 不再占用", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const search = page.getByPlaceholder("搜索笔记...");

  await page.keyboard.press("Alt+e");
  await expect(search).toBeFocused();

  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+e");
  await expect(search).not.toBeFocused();
});

test("四至六级标题字号不小于正文", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();

  const markdown = [
    "#### 四级标题",
    "##### 五级标题",
    "###### 六级标题",
    "正文文字",
  ].join("\n\n");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, markdown);

  const readSizes = () => editor.evaluate((element) => {
    const fontSize = (selector: string) => {
      const target = element.querySelector(selector);
      if (!target) throw new Error(`${selector} not found`);
      return Number.parseFloat(getComputedStyle(target).fontSize);
    };
    return {
      paragraph: fontSize("p"),
      h4: fontSize("h4"),
      h5: fontSize("h5"),
      h6: fontSize("h6"),
    };
  });
  const sizes = await readSizes();
  const noteTitleBefore = await page.locator(".note-title").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

  expect(sizes.h4).toBeGreaterThanOrEqual(sizes.paragraph);
  expect(sizes.h5).toBeGreaterThanOrEqual(sizes.paragraph);
  expect(sizes.h6).toBeGreaterThanOrEqual(sizes.paragraph);

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await page.getByRole("button", { name: "增大正文与标题字号" }).click();
  await page.getByRole("button", { name: "应用到编辑器" }).click();

  const enlarged = await readSizes();
  const noteTitleAfter = await page.locator(".note-title").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(enlarged.paragraph).toBeGreaterThan(sizes.paragraph);
  expect(enlarged.h4).toBeGreaterThan(sizes.h4);
  expect(enlarged.h5).toBeGreaterThan(sizes.h5);
  expect(enlarged.h6).toBeGreaterThan(sizes.h6);
  expect(noteTitleAfter).toBeGreaterThan(noteTitleBefore);
});

test("纯粗体小节标签与下一段正文保持紧凑间距", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "**概念**\n正文说明\n\n下一段正文");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });

  const paragraphs = editor.locator(":scope > p");
  await expect(paragraphs).toHaveCount(3);
  await expect(paragraphs.nth(0).locator("strong")).toHaveText("概念");
  await expect(paragraphs.nth(0)).toHaveClass(/standalone-strong-label/);
  const spacing = await editor.evaluate((element) => {
    const [label, body, nextBody] = [...element.querySelectorAll<HTMLElement>(":scope > p")];
    const labelRect = label.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const nextBodyRect = nextBody.getBoundingClientRect();
    return {
      labelToBody: bodyRect.top - labelRect.bottom,
      bodyToBody: nextBodyRect.top - bodyRect.bottom,
      labelMarginBottom: Number.parseFloat(getComputedStyle(label).marginBottom),
      bodyMarginTop: Number.parseFloat(getComputedStyle(body).marginTop),
    };
  });
  expect(spacing.bodyMarginTop).toBe(0);
  expect(spacing.labelToBody).toBeCloseTo(spacing.labelMarginBottom, 1);
  expect(spacing.labelToBody).toBeLessThan(spacing.bodyToBody / 2);
});

test("局部加粗正文不会改变其后分割线间距", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "这是**第一优先级**。\n\n---\n\n中间正文\n\n这是普通优先级。\n\n---\n\n末尾正文",
    );
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });

  const partialStrong = editor.getByText("这是第一优先级。", { exact: true });
  const regular = editor.getByText("这是普通优先级。", { exact: true });
  await expect(partialStrong.locator("strong")).toHaveText("第一优先级");
  await expect(partialStrong).not.toHaveClass(/standalone-strong-label/);
  await expect(editor.locator(":scope > hr")).toHaveCount(2);
  const gaps = await editor.evaluate((element) => {
    const paragraphs = [...element.querySelectorAll<HTMLElement>(":scope > p")];
    const gapAfter = (text: string) => {
      const paragraph = paragraphs.find((item) => item.textContent === text);
      const rule = paragraph?.nextElementSibling;
      if (!paragraph || !(rule instanceof HTMLHRElement)) throw new Error(`HR after ${text} not found`);
      return rule.getBoundingClientRect().top - paragraph.getBoundingClientRect().bottom;
    };
    return {
      partialStrong: gapAfter("这是第一优先级。"),
      regular: gapAfter("这是普通优先级。"),
    };
  });
  expect(gaps.partialStrong).toBeCloseTo(gaps.regular, 1);
});

test("当前行高亮保持轻量且代码块字号接近正文", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();

  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "```ts\nconst answer = 42;\n```");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });

  const code = editor.locator("pre code").first();
  await expect(code).toContainText("const answer = 42;");
  const sizes = await editor.evaluate((element) => ({
    body: Number.parseFloat(getComputedStyle(element).fontSize),
    code: Number.parseFloat(getComputedStyle(element.querySelector("pre code")!).fontSize),
    activeLine: getComputedStyle(document.documentElement).getPropertyValue("--activeline-bg").trim(),
  }));
  expect(sizes.code / sizes.body).toBeGreaterThanOrEqual(0.94);
  expect(sizes.code / sizes.body).toBeLessThanOrEqual(1);
  expect(sizes.activeLine).toBe("rgba(9, 105, 218, 0.06)");
});
