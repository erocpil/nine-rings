import { expect, test } from "@playwright/test";

test("包含段落和代码块的松散有序列表保持连续编号", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("有序列表编号测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const markdown = [
    "1. **PCI枚举并为设备资源编址**",
    "",
    "   第一项的说明文字。",
    "",
    "   ```text",
    "   BAR0 memory resource",
    "   ```",
    "",
    "2. **把PCI function绑定给VFIO**",
    "",
    "   第二项的说明文字。",
    "",
    "3. **查询VFIO region并映射BAR资源**",
  ].join("\n");
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, markdown);

  const listStarts = () => editor.locator("ol").evaluateAll(
    (lists) => lists.map((list) => (list as HTMLOListElement).start),
  );
  await expect.poll(listStarts).toEqual([1, 2, 3]);
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("有序列表编号测试");
  await expect.poll(listStarts).toEqual([1, 2, 3]);
});

test("有序列表的续行和后续列表项保持同一正文缩进", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("aaa");
  await page.getByTitle("有序列表 (Ctrl+Shift+7)").click();
  await editor.press("End");
  await editor.press("Shift+Enter");
  await editor.type("bbb");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("ccc");
  await editor.press("Shift+Enter");
  await editor.type("ddd");

  const listItems = editor.locator("ol > li");
  await expect(listItems).toHaveCount(2);
  await expect(listItems.nth(0)).toHaveText("aaabbb");
  await expect(listItems.nth(1)).toHaveText("cccddd");

  const textLefts = await listItems.evaluateAll((items) => items.flatMap((item) => {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const lefts: number[] = [];
    let node = walker.nextNode();
    while (node) {
      if ((node.textContent ?? "").trim()) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        lefts.push(range.getBoundingClientRect().left);
      }
      node = walker.nextNode();
    }
    return lefts;
  }));
  expect(textLefts).toHaveLength(4);
  textLefts.forEach((left) => expect(Math.abs(left - textLefts[0])).toBeLessThan(1));
});

test("两位数及以上的有序列表编号使用共享左边缘", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  const markdown = Array.from({ length: 12 }, (_, index) => `${index + 1}. 项目 ${index + 1}`).join("\n");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, markdown);

  const listItems = editor.locator(":scope > ol > li");
  await expect(listItems).toHaveCount(12);
  const markerStyles = await listItems.evaluateAll((items) => items.map((item) => {
    const style = getComputedStyle(item, "::before");
    return {
      left: style.left,
      width: style.width,
      textAlign: style.textAlign,
      transform: style.transform,
    };
  }));
  expect(new Set(markerStyles.map((style) => style.left)).size).toBe(1);
  expect(new Set(markerStyles.map((style) => style.width)).size).toBe(1);
  markerStyles.forEach((style) => {
    expect(style.textAlign).toBe("left");
    expect(style.transform).toBe("none");
  });
});

test("粘贴 Markdown 时列表 lazy continuation 保留为对齐的续行", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "1. aaa\nbbb\n2. ccc\n   ddd");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });

  const listItems = editor.locator("ol > li");
  await expect(listItems).toHaveCount(2);
  await expect(listItems.nth(0).locator("br")).toHaveCount(1);
  await expect(listItems.nth(1).locator("br")).toHaveCount(1);

  const lefts = await listItems.evaluateAll((items) => items.flatMap((item) => {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    const values: number[] = [];
    let node = walker.nextNode();
    while (node) {
      if ((node.textContent ?? "").trim()) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        values.push(range.getBoundingClientRect().left);
      }
      node = walker.nextNode();
    }
    return values;
  }));
  expect(lefts).toHaveLength(4);
  lefts.forEach((left) => expect(Math.abs(left - lefts[0])).toBeLessThan(1));
});
