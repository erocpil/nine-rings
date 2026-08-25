import { expect, test } from "@playwright/test";

async function createBlankNote(page: import("@playwright/test").Page) {
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
}

async function enableVimMode(page: import("@playwright/test").Page) {
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
  const field = page.locator(".settings-field").filter({ hasText: "Vim 模式（实验性）" });
  if (!(await field.locator('input[type="checkbox"]').isChecked())) await field.locator(".settings-toggle").click();
  await page.locator(".settings-close").click();
}

test("正文书签可切换、跳转并随文档保存", async ({ page }) => {
  await page.goto("/");
  await createBlankNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("第一段");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("第二段书签位置");
  await page.keyboard.press("Control+Shift+m");

  const bookmarkButton = page.getByRole("button", { name: "文档书签" });
  await expect(bookmarkButton).toContainText("1");
  await bookmarkButton.click();
  const panel = page.getByRole("navigation", { name: "文档书签" });
  await expect(panel).toContainText("第二段书签位置");
  await expect(page.locator(".editor-block-bookmark")).toHaveCount(1);

  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "文档书签" })).toContainText("1");
});

test("设置中的书签列表包含文档书签", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("书签集中管理测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("设置页应显示的文档书签");
  await page.keyboard.press("Control+Shift+m");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^文档管理/ }).click();
  await page.getByRole("button", { name: /^书签/ }).click();
  const bookmarkManager = page.locator(".bookmark-manager-list");
  await expect(bookmarkManager).toContainText("书签集中管理测试");
  await expect(bookmarkManager).toContainText("设置页应显示的文档书签");
});

test("Vim m{a-z} 设置命名书签，'{a-z} 跳转", async ({ page }) => {
  await page.goto("/");
  await createBlankNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("第一段");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("第二段");
  await enableVimMode(page);
  await editor.getByText("第二段", { exact: true }).click();
  await page.keyboard.press("m");
  await page.keyboard.press("a");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("'");
  await page.keyboard.press("a");

  await expect.poll(() => page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("p")?.textContent ?? "";
  })).toBe("第二段");
});

test("书签定位高亮固定在目标块，不跟随之后的点击", async ({ page }) => {
  await page.goto("/");
  await createBlankNote(page);
  const editor = page.locator(".ProseMirror");
  await editor.fill("第一段");
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("第二段书签位置");
  const firstParagraph = editor.getByText("第一段", { exact: true });
  const targetParagraph = editor.getByText("第二段书签位置", { exact: true });
  await page.keyboard.press("Control+Shift+m");
  await firstParagraph.click();
  await page.getByRole("button", { name: "文档书签" }).click();
  await page.locator(".document-bookmark-jump").click();

  await expect(page.locator(".note-editor")).toHaveClass(/bookmark-jump-pulsing/);
  await expect(targetParagraph).toHaveClass(/bookmark-jump-target/);
  await firstParagraph.click();
  await expect(page.locator(".note-editor")).toHaveClass(/bookmark-jump-pulsing/);
  await expect(firstParagraph).not.toHaveClass(/bookmark-jump-target/);
  await expect.poll(() => firstParagraph.evaluate((element) => (
    getComputedStyle(element).animationName
  ))).not.toContain("bookmark-jump-target-pulse");
});

test.describe("移动端书签操作", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("轻触书签条目跳转到对应文档块", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    const paragraphs = [
      "第一段",
      ...Array.from({ length: 38 }, (_, index) => `用于撑开滚动区的段落 ${index + 2}`),
      "手机端书签跳转目标",
    ];
    await editor.fill("");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, paragraphs.join("\n\n"));
    const firstParagraph = editor.getByText("第一段", { exact: true });
    const targetParagraph = editor.getByText("手机端书签跳转目标", { exact: true });
    await expect(targetParagraph).toBeAttached();
    await targetParagraph.click();
    await page.keyboard.press("Control+Shift+m");
    await firstParagraph.click();
    await page.locator(".note-editor-scroll").evaluate((element) => { element.scrollTop = 0; });

    const bookmarkButton = page.locator(".document-bookmark-toggle");
    const bookmarkButtonBox = await bookmarkButton.boundingBox();
    if (!bookmarkButtonBox) throw new Error("书签按钮不可见");
    await page.touchscreen.tap(
      bookmarkButtonBox.x + bookmarkButtonBox.width / 2,
      bookmarkButtonBox.y + bookmarkButtonBox.height / 2,
    );

    const panel = page.getByRole("navigation", { name: "文档书签" });
    const jumpButton = panel.locator(".document-bookmark-jump");
    await expect(jumpButton).toBeVisible();
    await expect(jumpButton).toContainText("手机端书签跳转目标");
    const jumpButtonBox = await jumpButton.boundingBox();
    if (!jumpButtonBox) throw new Error("书签条目不可见");
    await page.touchscreen.tap(
      jumpButtonBox.x + jumpButtonBox.width / 2,
      jumpButtonBox.y + jumpButtonBox.height / 2,
    );

    await expect(panel).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const anchor = window.getSelection()?.anchorNode;
      return (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("p")?.textContent ?? "";
    })).toBe("手机端书签跳转目标");
    await expect(page.locator(".note-editor")).toHaveClass(/bookmark-jump-pulsing/);
    await expect(page.locator(".editor-block-bookmark.bookmark-jump-gutter")).toHaveCount(1);
    await expect.poll(async () => {
      const targetBox = await targetParagraph.boundingBox();
      const scrollBox = await page.locator(".note-editor-scroll").boundingBox();
      const stickyBox = await page.locator(".note-editor-sticky").boundingBox();
      return Boolean(
        targetBox
        && scrollBox
        && stickyBox
        && targetBox.y >= stickyBox.y + stickyBox.height
        && targetBox.y + targetBox.height <= scrollBox.y + scrollBox.height,
      );
    }).toBe(true);
  });

  test("向左滑动书签行后显示重命名和删除操作", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.fill("移动端书签操作测试");
    await page.keyboard.press("Control+Shift+m");

    const bookmarkButton = page.locator(".document-bookmark-toggle");
    await expect(bookmarkButton).toContainText("1");
    await bookmarkButton.click();

    const row = page.locator(".document-bookmark-item");
    const actions = page.locator(".document-bookmark-action");
    await expect(actions).toHaveCount(2);
    await row.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 300,
      clientY: 120,
    });
    await row.dispatchEvent("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 190,
      clientY: 121,
    });
    await row.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 190,
      clientY: 121,
    });
    await expect(row).toHaveClass(/swipe-open/);

    const readGeometry = () => actions.evaluateAll((buttons) => {
      const [rename, remove] = buttons.map((button) => button.getBoundingClientRect());
      const row = buttons[0].closest(".document-bookmark-item")!.getBoundingClientRect();
      const content = buttons[0].closest(".document-bookmark-item")!
        .querySelector(".document-bookmark-jump")!.getBoundingClientRect();
      return {
        widths: [rename.width, remove.width],
        heights: [rename.height, remove.height],
        gap: remove.left - rename.right,
        actionsRevealed: content.right <= rename.left + 0.5 && remove.right <= row.right + 0.5,
      };
    });
    await expect.poll(async () => (await readGeometry()).actionsRevealed).toBe(true);
    const geometry = await readGeometry();
    expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(44);
    expect(Math.min(...geometry.heights)).toBeGreaterThanOrEqual(44);
    expect(geometry.gap).toBeGreaterThanOrEqual(8);
    expect(geometry.actionsRevealed).toBe(true);
  });
});
