import { expect, test, type Locator } from "@playwright/test";

test("只读文档拒绝 Windows WebView2 式粘贴事件", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("只读原文");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");

  const prevented = await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 不应粘贴的标题\n\n不应出现的正文");
    return !element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });
  expect(prevented).toBe(true);
  await expect(editor).toHaveText("只读原文");
  await expect(editor.getByRole("heading", { name: "不应粘贴的标题" })).toHaveCount(0);
});

test("只读文档隐藏代码语法选项并保留查看操作", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "```typescript\nconst answer = 42;\n```");
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });
  const codeBlock = editor.locator(".code-block-wrap");
  const codeTitle = codeBlock.getByLabel("代码简介");
  await expect(codeBlock.getByLabel("代码语言")).toBeVisible();
  await codeTitle.hover();
  await expect(codeTitle).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(codeTitle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await codeTitle.focus();
  await expect(codeTitle).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(codeBlock.getByLabel("代码语言")).toHaveCount(0);
  await expect(codeTitle).toBeHidden();
  await expect(codeTitle).toHaveCSS("visibility", "hidden");
  expect(await codeTitle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

  const collapseButton = codeBlock.getByRole("button", { name: "折叠代码块" });
  const wrapButton = codeBlock.getByRole("button", { name: "关闭代码软换行" });
  const copyButton = codeBlock.getByRole("button", { name: "复制代码" });
  await expect(collapseButton).toBeEnabled();
  await expect(wrapButton).toBeEnabled();
  await expect(copyButton).toBeEnabled();
  await collapseButton.click();
  await expect(codeBlock).toHaveAttribute("data-collapsed", "true");
  await codeBlock.getByRole("button", { name: "展开代码块" }).click();
  await wrapButton.click();
  await expect(codeBlock).toHaveAttribute("data-code-wrap", "false");

  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  await expect(page.getByLabel("专注模式工具栏")).toBeVisible();
  await expect(codeBlock.getByLabel("代码语言")).toHaveCount(0);
  await expect(codeBlock.getByRole("button", { name: "折叠代码块" })).toBeEnabled();
  await expect(codeBlock.getByRole("button", { name: "开启代码软换行" })).toBeEnabled();
  await expect(codeBlock.getByRole("button", { name: "复制代码" })).toBeEnabled();
});

test("只有只读专注模式双击标题或正文才切换所属标题章节", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("一级标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("一级正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("二级标题");
  await editor.press("Control+Alt+2");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("二级正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("下一个一级标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("末尾正文");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(editor).toHaveAttribute("contenteditable", "false");
  const firstHeading = editor.locator("h1").filter({ hasText: /^一级标题$/ });
  const nestedHeading = editor.locator("h2").filter({ hasText: /^二级标题$/ });
  const nextHeading = editor.locator("h1").filter({ hasText: /^下一个一级标题$/ });

  await firstHeading.dblclick();
  await expect(editor.getByText("一级正文", { exact: true })).toBeVisible();
  await page.locator(".note-title-row").getByTitle("专注模式").click();

  await firstHeading.dblclick();
  await expect(editor.getByText("一级正文", { exact: true })).toBeHidden();
  await expect(nestedHeading).toBeHidden();
  await expect(nextHeading).toBeVisible();

  await firstHeading.dblclick();
  await expect(editor.getByText("一级正文", { exact: true })).toBeVisible();
  await expect(nestedHeading).toBeVisible();

  await editor.getByText("二级正文", { exact: true }).dblclick();
  await expect(editor.getByText("二级正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("一级正文", { exact: true })).toBeVisible();
  await expect(nestedHeading).toBeVisible();

  await nestedHeading.dblclick();
  await expect(editor.getByText("二级正文", { exact: true })).toBeVisible();
});

test("只读正文双击折叠后所属标题停留在双击位置附近", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const precedingBody = Array.from({ length: 24 }, (_, index) => `前置正文 ${index + 1}`).join("\n\n");
  const sectionBody = Array.from({ length: 36 }, (_, index) => `目标正文 ${index + 1}`).join("\n\n");
  const trailingBody = Array.from({ length: 36 }, (_, index) => `后续正文 ${index + 1}`).join("\n\n");
  await editor.click();
  await editor.evaluate((element, markdown) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", markdown);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, `# 前置章节\n\n${precedingBody}\n\n# 待折叠章节\n\n${sectionBody}\n\n# 后续章节\n\n${trailingBody}`);
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.locator(".note-title-row").getByTitle("专注模式").click();

  const target = editor.getByText("目标正文 25", { exact: true });
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  const doubleClickY = targetBox!.y + targetBox!.height / 2;

  await target.dblclick();
  await expect(target).toBeHidden();
  const headingBox = await editor.getByText("待折叠章节", { exact: true }).boundingBox();
  expect(headingBox).not.toBeNull();
  const headingCenterY = headingBox!.y + headingBox!.height / 2;
  expect(Math.abs(headingCenterY - doubleClickY)).toBeLessThan(24);
});

test("手机只读专注模式可通过触摸双击折叠和展开章节", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("触摸标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("触摸正文");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("后续标题");
  await editor.press("Control+Alt+1");
  await editor.press("End");
  await editor.press("Enter");
  await editor.type("后续正文");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  await expect(page.getByLabel("专注模式工具栏")).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "false");

  const touchDoubleTap = async (target: Locator) => {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const clientX = box!.x + box!.width / 2;
    const clientY = box!.y + box!.height / 2;
    for (let tap = 0; tap < 2; tap += 1) {
      await target.dispatchEvent("pointerdown", {
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        clientX,
        clientY,
      });
      await target.dispatchEvent("pointerup", {
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        clientX,
        clientY,
      });
    }
    // WebKit 可能在触摸 pointer 序列之后继续补发 dblclick；不能切换两次。
    await target.dispatchEvent("dblclick", { clientX, clientY });
  };

  const heading = editor.getByText("触摸标题", { exact: true });
  const body = editor.getByText("触摸正文", { exact: true });
  await touchDoubleTap(body);
  await expect(body).toBeHidden();
  await expect(editor.getByText("后续标题", { exact: true })).toBeVisible();

  await touchDoubleTap(heading);
  await expect(body).toBeVisible();
});

test("手机文档末章的最后几个段落可反复折叠和展示", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 前章\n\n前章正文\n\n# 最后一章\n\n尾段一\n\n尾段二\n\n尾段三");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });
  await page.locator(".note-title-row").getByTitle("专注模式").click();

  const heading = editor.getByText("最后一章", { exact: true });
  const lastBody = editor.getByText("尾段三", { exact: true });
  await lastBody.dblclick();
  await expect(lastBody).toBeHidden();
  await heading.dblclick();
  await expect(lastBody).toBeVisible();
  await heading.dblclick();
  await expect(lastBody).toBeHidden();
  await heading.dblclick();
  await expect(lastBody).toBeVisible();
});

test("千块只读文档在专注模式下触摸双击可及时折叠", async ({ page }) => {
  test.slow();
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const body = Array.from({ length: 1200 }, (_, index) => `长文档正文 ${index + 1}`).join("\n\n");
  await editor.evaluate((element, markdown) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", markdown);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, `# 长文档章节\n\n${body}\n\n# 后续章节\n\n后续正文`);
  await expect(editor.locator(":scope > *")).toHaveCount(1203);
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 10000 });

  await page.locator(".sidebar-item.active").getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 100 } });
  await page.locator(".note-title-row").getByTitle("专注模式").click();

  const target = editor.getByText("长文档正文 600", { exact: true });
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const foldWork = await target.evaluate((element) => {
    const editorElement = element.closest(".ProseMirror")!;
    const observer = new MutationObserver(() => undefined);
    observer.observe(editorElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    const rect = element.getBoundingClientRect();
    const init = {
      bubbles: true,
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new PointerEvent("pointerdown", init));
    element.dispatchEvent(new PointerEvent("pointerup", init));
    const startedAt = performance.now();
    element.dispatchEvent(new PointerEvent("pointerdown", init));
    element.dispatchEvent(new PointerEvent("pointerup", init));
    const elapsed = performance.now() - startedAt;
    const blockAttributeMutations = observer.takeRecords().length;
    observer.disconnect();
    return { elapsed, blockAttributeMutations };
  });
  await expect(target).toBeHidden();
  await expect(editor.getByText("后续章节", { exact: true })).toBeVisible();
  expect(foldWork.blockAttributeMutations).toBeLessThan(20);
  expect(foldWork.elapsed).toBeLessThan(100);
});
