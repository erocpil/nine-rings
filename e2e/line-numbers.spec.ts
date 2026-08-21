import { test, expect, type Page } from "@playwright/test";

async function openEditorSettings(page: Page) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器/ }).click();
}

test.describe("编辑器块级 gutter", () => {
  test("Alt-G 可按稳定块编号跳转且不挤压正文", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill(Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 块`).join("\n"));
    const editorTopBefore = await editor.evaluate((element) => element.getBoundingClientRect().top);
    await editor.press("Alt+g");

    const jumpInput = page.getByRole("dialog", { name: "跳转行号" }).getByLabel("跳转到行号");
    await expect(jumpInput).toBeVisible();
    await expect(page.locator(".editor-line-jump")).toHaveCSS("position", "absolute");
    const editorTopAfter = await editor.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(editorTopAfter - editorTopBefore)).toBeLessThan(1);

    await jumpInput.fill("30");
    await jumpInput.press("Enter");
    await expect(jumpInput).toHaveCount(0);
    await expect.poll(() => editor.evaluate((element) => {
      const anchor = window.getSelection()?.anchorNode;
      const block = anchor instanceof Element ? anchor.closest(":scope > p") : anchor?.parentElement?.closest("p");
      return block?.textContent ?? "";
    })).toBe("第 30 块");
    await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
      (element) => (element as HTMLElement).scrollTop,
    )).toBeGreaterThan(100);

    await editor.press("Alt+g");
    await jumpInput.fill("99");
    await jumpInput.press("Enter");
    await expect(page.getByRole("status")).toHaveText("请输入 1–36");
    await jumpInput.press("Escape");
    await expect(jumpInput).toHaveCount(0);
  });

  test("只读文档仍显示块编号，但不显示插入按钮", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一行");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("第二行");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await openEditorSettings(page);
    const lineNumberField = page.locator(".settings-field").filter({ hasText: "显示块编号" });
    const lineNumberToggle = lineNumberField.locator('input[type="checkbox"]');
    await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    await expect(lineNumberToggle).toBeChecked();
    await page.locator(".settings-close").click();
    await expect(page.locator(".note-editor")).toHaveClass(/show-line-numbers/);
    await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-width", "32px");

    const readonlyButton = page.locator(".sidebar-item.active").getByTitle("设为只读");
    await readonlyButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(editor).toHaveAttribute("contenteditable", "false");

    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2"]);
    await expect(page.locator(".editor-block-insert")).toHaveCount(0);
  });

  test("悬停块编号会在原位置显示块格式", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("三级标题");
    await editor.press("Control+Alt+3");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("正文");

    await openEditorSettings(page);
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();

    const blockNumbers = page.locator(".editor-block-number");
    await expect(blockNumbers).toHaveText(["1", "2"]);
    await expect(blockNumbers.nth(0)).toHaveAttribute("data-block-format", "H3");
    await expect(blockNumbers.nth(1)).toHaveAttribute("data-block-format", "Text");

    const tooltipOpacity = (element: Element) => getComputedStyle(element, "::after").opacity;
    const inlineStyle = (element: Element) => ({
      numberColor: getComputedStyle(element).color,
      formatBackground: getComputedStyle(element, "::after").backgroundColor,
      formatBorderWidth: getComputedStyle(element, "::after").borderWidth,
    });
    const hoverNumber = async (index: number) => {
      const number = blockNumbers.nth(index);
      const box = await number.boundingBox();
      if (!box) throw new Error("block number geometry not found");
      await number.hover({
        position: { x: Math.max(1, box.width - 2), y: box.height / 2 },
      });
    };
    await expect.poll(() => blockNumbers.nth(0).evaluate(tooltipOpacity)).toBe("0");
    await hoverNumber(0);
    await expect.poll(() => blockNumbers.nth(0).evaluate(tooltipOpacity)).toBe("1");
    await expect.poll(() => blockNumbers.nth(0).evaluate(inlineStyle)).toEqual({
      numberColor: "rgba(0, 0, 0, 0)",
      formatBackground: "rgba(0, 0, 0, 0)",
      formatBorderWidth: "0px",
    });
    await expect.poll(() => blockNumbers.nth(1).evaluate(tooltipOpacity)).toBe("0");
    await hoverNumber(1);
    await expect.poll(() => blockNumbers.nth(1).evaluate(tooltipOpacity)).toBe("1");
    await expect.poll(() => blockNumbers.nth(0).evaluate(tooltipOpacity)).toBe("0");
    await expect.poll(() => blockNumbers.nth(0).evaluate(
      (element) => getComputedStyle(element).color,
    )).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("只有明确的加号按钮会插入段落", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一块\n第二块");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await openEditorSettings(page);
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();
    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2"]);
    await expect(page.locator(".editor-block-insert")).toHaveCount(3);

    const gutterLanes = await page.locator(".editor-content-shell").evaluate((shell) => {
      const number = shell.querySelector(".editor-block-number")!.getBoundingClientRect();
      const insert = shell.querySelector(".editor-block-insert")!.getBoundingClientRect();
      return { insertRight: insert.right, numberLeft: number.left };
    });
    expect(gutterLanes.insertRight).toBeLessThanOrEqual(gutterLanes.numberLeft);

    // 编号仅用于显示，强制触发点击也不能产生编辑事务。
    await page.locator(".editor-block-number").first().dispatchEvent("click");
    await expect(editor.locator(":scope > p")).toHaveCount(2);

    await page.getByRole("button", { name: "在第 1 块后插入段落" }).click();
    await page.keyboard.type("插入块");
    await expect(editor.locator(":scope > p")).toHaveCount(3);
    await expect(editor.locator(":scope > p").nth(1)).toHaveText("插入块");
  });

  test("分割线后的插入按钮位于分割线与下一块之间", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一块");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("---");
    await expect(editor.locator(":scope > hr")).toHaveCount(1);
    await editor.type("下一块");

    await openEditorSettings(page);
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();
    await expect(page.locator(".editor-block-number")).toHaveText(["1", "2", "3"]);

    const dividerBox = await editor.locator(":scope > hr").boundingBox();
    const nextBlockBox = await editor.locator(":scope > p").last().boundingBox();
    const insertBox = await page.getByRole("button", { name: "在第 2 块后插入段落" }).boundingBox();
    if (!dividerBox || !nextBlockBox || !insertBox) throw new Error("gutter geometry not found");
    const insertCenter = insertBox.y + insertBox.height / 2;
    expect(insertCenter).toBeGreaterThan(dividerBox.y + dividerBox.height + 2);
    expect(insertCenter).toBeLessThan(nextBlockBox.y);
  });

  test("有序与无序列表缩进在块号开关前后保持稳定", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    const markdown = "正文\n\n- 无序项目\n\n1. 有序项目";
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);
    await expect(editor.locator(":scope > ul")).toHaveCount(1);
    await expect(editor.locator(":scope > ol")).toHaveCount(1);

    const readGeometry = () => editor.evaluate((element) => {
      const paragraph = element.querySelector(":scope > p")!;
      const unordered = element.querySelector(":scope > ul")!;
      const ordered = element.querySelector(":scope > ol")!;
      const unorderedItem = unordered.querySelector(":scope > li")!;
      const orderedItem = ordered.querySelector(":scope > li")!;
      const orderedBlockNumber = document.querySelector<HTMLElement>('.editor-block-number[data-block-format="OL"]');
      const rect = (target: Element) => target.getBoundingClientRect();
      return {
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        paragraphLeft: rect(paragraph).left,
        unorderedLeft: rect(unordered).left,
        orderedLeft: rect(ordered).left,
        unorderedItemLeft: rect(unorderedItem).left,
        orderedItemLeft: rect(orderedItem).left,
        unorderedPadding: Number.parseFloat(getComputedStyle(unordered).paddingInlineStart),
        orderedPadding: Number.parseFloat(getComputedStyle(ordered).paddingInlineStart),
        orderedMarker: getComputedStyle(orderedItem, "::before").content,
        orderedNativeMarker: getComputedStyle(orderedItem, "::marker").content,
        orderedBlockNumberRight: orderedBlockNumber ? rect(orderedBlockNumber).right : null,
      };
    });

    const withoutNumbers = await readGeometry();
    expect(withoutNumbers.unorderedItemLeft - withoutNumbers.unorderedLeft)
      .toBeCloseTo(withoutNumbers.unorderedPadding, 1);
    expect(withoutNumbers.orderedItemLeft - withoutNumbers.orderedLeft)
      .toBeCloseTo(withoutNumbers.orderedPadding, 1);
    expect(withoutNumbers.orderedPadding - withoutNumbers.unorderedPadding)
      .toBeCloseTo(withoutNumbers.fontSize * 0.75, 1);
    expect(withoutNumbers.orderedMarker).toContain("counter(list-item)");
    expect(withoutNumbers.orderedMarker).not.toContain("•");
    expect(withoutNumbers.orderedNativeMarker).toBe('""');

    await openEditorSettings(page);
    const lineNumberToggle = page.locator(".settings-field").filter({ hasText: "显示块编号" })
      .locator('input[type="checkbox"]');
    if (!(await lineNumberToggle.isChecked())) {
      await lineNumberToggle.evaluate((input: HTMLInputElement) => input.click());
    }
    await page.locator(".settings-close").click();
    await expect(page.locator('.editor-block-number[data-block-format="OL"]')).toHaveCount(1);

    const withNumbers = await readGeometry();
    expect(withNumbers.unorderedPadding).toBeCloseTo(withoutNumbers.unorderedPadding, 1);
    expect(withNumbers.orderedPadding).toBeCloseTo(withoutNumbers.orderedPadding, 1);
    expect(withNumbers.unorderedItemLeft - withNumbers.unorderedLeft)
      .toBeCloseTo(withoutNumbers.unorderedItemLeft - withoutNumbers.unorderedLeft, 1);
    expect(withNumbers.orderedItemLeft - withNumbers.orderedLeft)
      .toBeCloseTo(withoutNumbers.orderedItemLeft - withoutNumbers.orderedLeft, 1);
    expect(withNumbers.unorderedLeft - withNumbers.paragraphLeft).toBeCloseTo(0, 1);
    expect(withNumbers.orderedLeft - withNumbers.paragraphLeft).toBeCloseTo(0, 1);
    expect(withNumbers.orderedBlockNumberRight).not.toBeNull();
    expect(withNumbers.orderedBlockNumberRight!).toBeLessThanOrEqual(withNumbers.orderedLeft);
  });

  test("状态栏块号跟随光标并可独立关闭", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("第一块\n第二块\n第三块");
    await editor.locator(":scope > p").nth(1).click();
    await expect(page.locator(".editor-status-block")).toHaveText("块 2 / 3");
    await expect(page.locator(".editor-status-position")).toBeVisible();

    await openEditorSettings(page);
    const statusToggle = page.locator(".settings-field").filter({ hasText: "状态栏块号" })
      .locator('input[type="checkbox"]');
    await expect(statusToggle).toBeChecked();
    await statusToggle.evaluate((input: HTMLInputElement) => input.click());
    await page.locator(".settings-close").click();

    await expect(page.locator(".editor-status-block")).toHaveCount(0);
    await expect(page.locator(".editor-status-position")).toBeVisible();
    await page.reload();
    await expect(page.locator(".editor-status-block")).toHaveCount(0);
  });
});
