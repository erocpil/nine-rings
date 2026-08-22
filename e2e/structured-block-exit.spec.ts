import { expect, test, type Page } from "@playwright/test";

async function createBlankNote(page: Page) {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
}

async function activateBlock(page: Page, name: "❝ 引用" | "⏹ 代码块") {
  await page.getByRole("button", { name: "块 ▾" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test.describe("结构块退出行为", () => {
  test.use({ viewport: { width: 800, height: 700 } });

  test("代码块行号可开启并随内容实时更新", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("first");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("second");

    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: "□ 显示代码行号", exact: true }).click();

    const gutter = editor.locator(".code-block-gutter");
    await expect(page.locator(".note-editor")).toHaveClass(/show-code-line-numbers/);
    await expect(gutter).toBeVisible();
    await expect(gutter.locator("span")).toHaveText(["1", "2"]);

    const code = editor.locator(".code-block-wrap code");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("third");
    await expect(code).toHaveText("first\nsecond\nthird");
    await expect(gutter.locator("span")).toHaveText(["1", "2", "3"]);
  });

  test("代码块末尾第二次 Enter 原子退出并保留代码内容", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("const answer = 42;");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("End");
    await editor.press("Enter");
    await expect(editor.locator(".code-block-wrap code")).toHaveText("const answer = 42;\n");
    await editor.press("Enter");

    await expect(editor.locator(".code-block-wrap code")).toHaveText("const answer = 42;");
    await expect(editor.locator(":scope > p")).toHaveCount(1);
    await editor.type("块外正文");
    await expect(editor.locator(":scope > p")).toHaveText("块外正文");
  });

  test("撤销退出会恢复代码块末尾空行而不破坏内容", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("undo-safe");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("Enter");
    await expect(editor.locator(":scope > p")).toHaveCount(1);

    await editor.press("Control+z");
    await expect(editor.locator(":scope > p")).toHaveCount(0);
    await expect(editor.locator(".code-block-wrap code")).toHaveText("undo-safe\n");
  });

  test("Shift+Enter 可以在代码块末尾保留连续空行", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("keep-blank-lines");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("End");
    await editor.press("Shift+Enter");
    await editor.press("Shift+Enter");

    await expect(editor.locator(":scope > p")).toHaveCount(0);
    await expect(editor.locator(".code-block-wrap code")).toHaveText("keep-blank-lines\n\n");
  });

  test("引用块只在末尾空段落退出并建立一个块外段落", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("需要保留的引用");
    await activateBlock(page, "❝ 引用");
    await editor.press("End");
    await editor.press("Enter");
    await expect(editor.locator(":scope > blockquote > p")).toHaveCount(2);
    await editor.press("Enter");

    await expect(editor.locator(":scope > blockquote")).toHaveText("需要保留的引用");
    await expect(editor.locator(":scope > blockquote > p")).toHaveCount(1);
    await expect(editor.locator(":scope > p")).toHaveCount(1);
  });

  test("Ctrl+Enter 可从非空代码块显式退出", async ({ page }) => {
    await createBlankNote(page);
    const editor = page.locator(".ProseMirror");
    await editor.fill("无需先制造空行");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("Control+Enter");

    await expect(editor.locator(".code-block-wrap code")).toHaveText("无需先制造空行");
    await expect(editor.locator(":scope > p")).toHaveCount(1);
  });
});

test.describe("触屏代码块退出行为", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("虚拟键盘 Enter 可连续插入空行并通过块菜单退出", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("mobile-code");
    await activateBlock(page, "⏹ 代码块");
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("Enter");

    await expect(editor.locator(":scope > p")).toHaveCount(0);
    await expect(editor.locator(".code-block-wrap code")).toHaveText("mobile-code\n\n");

    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: /退出当前块/ }).click();
    await expect(editor.locator(":scope > p")).toHaveCount(1);
    await expect(editor.locator(".code-block-wrap code")).toHaveText("mobile-code\n\n");
  });
});
