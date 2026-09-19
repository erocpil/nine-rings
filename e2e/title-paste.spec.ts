import { expect, test, type Page } from "@playwright/test";

async function createBlankNote(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  await page
    .getByRole("dialog", { name: "新建文档", exact: true })
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("粘贴回归文档");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "文档标题", exact: true }),
  ).toHaveValue("粘贴回归文档");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeEditable();
  await expect(editor).toHaveText("");
  return editor;
}

for (const content of ["https://example.com/title", "**标题中的原始文字**"]) {
  test(`标题原生粘贴保留文本且不修改正文：${content}`, async ({ page }) => {
    const editor = await createBlankNote(page);
    await editor.fill("正文保持不变");
    const title = page.getByRole("textbox", { name: "文档标题", exact: true });
    await title.fill(content);
    await title.selectText();
    await title.press("ControlOrMeta+c");
    await title.fill("");
    await expect(title).toHaveAttribute("placeholder", "输入文档标题");
    await title.press("ControlOrMeta+v");
    await expect(title).toHaveValue(content);
    await expect(title).toBeFocused();
    await expect(editor).toHaveText("正文保持不变");
    await expect(editor.locator("a, strong")).toHaveCount(0);
  });
}

test("正文仍选中代码块时，标题粘贴不被代码块截获", async ({ page }) => {
  const editor = await createBlankNote(page);
  await editor.fill("原有代码");
  await page.getByTitle("代码块 (Ctrl+Alt+C)").click();
  await expect(editor.locator("pre code")).toHaveText("原有代码");
  const title = page.getByRole("textbox", { name: "文档标题", exact: true });
  await title.fill("前后");
  await title.focus();
  const allowed = await title.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "新标题");
    return element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  expect(allowed).toBe(true);
  await expect(title).toBeFocused();
  await expect(editor.locator("pre code")).toHaveText("原有代码");

  // The same event must still be handled when it actually targets the body.
  await editor.locator("pre code").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "正文粘贴");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(editor.locator("pre code")).toContainText("正文粘贴");
});

test("标题粘贴图片不会向正文插图", async ({ page }) => {
  const editor = await createBlankNote(page);
  await editor.fill("正文保持不变");
  const title = page.getByRole("textbox", { name: "文档标题", exact: true });
  await title.focus();
  const allowed = await title.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(["image"], "image.png", { type: "image/png" }),
    );
    return element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  expect(allowed).toBe(true);
  await expect(title).toBeFocused();
  await expect(editor).toHaveText("正文保持不变");
  await expect(editor.locator("img")).toHaveCount(0);
});
