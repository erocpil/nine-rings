import { expect, test } from "@playwright/test";

test("标题章节可按层级折叠，并从目录统一展开", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 总览\n\n总览正文\n\n## 子节\n\n子节正文\n\n# 第二部分\n\n末尾正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.getByRole("button", { name: "折叠第 1 块章节" }).click();
  await expect(editor.getByText("总览正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();
  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await expect(outline.getByTitle("子节", { exact: true })).toHaveCount(0);
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByRole("button", { name: "全部展开" }).dblclick();
  await expect(editor.getByText("总览正文", { exact: true })).toBeVisible();
  await expect(editor.getByText("子节", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("子节", { exact: true })).toBeVisible();
  await outline.getByLabel("折叠章节 子节").click();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();

  // 标题文字只负责跳转；折叠状态只能由前方三角切换。
  await outline.locator('.document-outline-item[title="子节"] .document-outline-link').click();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(outline).toHaveCount(0);
  await page.getByTitle("文档目录").click();
  await expect(outline.getByLabel("展开章节 子节")).toBeVisible();

  await outline.getByRole("button", { name: "全部折叠" }).dblclick();
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByLabel("展开章节 总览").click();
  await expect(outline.getByLabel("展开章节 子节")).toBeVisible();

  // 同一帧内快速切换只触发一次 React 目录重绘，最终状态仍准确。
  await outline.evaluate((element) => {
    const collapse = element.querySelector<HTMLButtonElement>('button[aria-label="全部折叠"]');
    const expand = element.querySelector<HTMLButtonElement>('button[aria-label="全部展开"]');
    if (!collapse || !expand) throw new Error("fold controls missing");
    for (let index = 0; index < 12; index += 1) {
      collapse.click();
      expand.click();
    }
  });
  await expect(outline.locator(".document-outline-item")).toHaveCount(3);
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
});

test("全部折叠在只有一个 H1 时保留 H2 总览", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 唯一根标题\n\n根说明\n\n## 章节一\n\n章节一正文\n\n### 章节一细节\n\n细节正文\n\n## 章节二\n\n章节二正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });

  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await outline.getByRole("button", { name: "全部折叠" }).dblclick();

  await expect(outline.locator(".document-outline-item")).toHaveCount(3);
  await expect(outline.getByTitle("唯一根标题", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节一", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节二", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节一细节", { exact: true })).toHaveCount(0);
  await expect(editor.getByText("根说明", { exact: true })).toBeVisible();
  await expect(editor.getByText("章节一正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("章节二正文", { exact: true })).toBeHidden();
});

test("目录全部折叠再全部展开后保持正文可视位置", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const markdown = Array.from({ length: 6 }, (_, section) => [
    `# 长章节 ${section + 1}`,
    ...Array.from({ length: 30 }, (_, paragraph) => `章节 ${section + 1} 正文 ${paragraph + 1}`),
  ].join("\n\n")).join("\n\n");
  await editor.click();
  await editor.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  const target = editor.getByText("章节 4 正文 18", { exact: true });
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  const before = await target.boundingBox();
  expect(before).not.toBeNull();

  await outline.getByRole("button", { name: "全部折叠" }).dblclick();
  await expect(target).toBeHidden();
  await outline.getByRole("button", { name: "全部展开" }).dblclick();
  await expect(target).toBeVisible();

  const after = await target.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(32);
});

test("桌面目录可固定到左右两侧并记住选择", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 固定目录标题\n\n正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(page.getByTitle("文档目录")).toBeVisible();
  await page.getByTitle("文档目录").click();

  const outline = page.getByRole("navigation", { name: "文档目录" });
  await outline.getByTitle("固定目录到左侧").click();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-left/);
  await expect(outline).toBeVisible();

  await outline.getByTitle("固定目录到右侧").click();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-right/);
  await page.reload();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-right/);
  await expect(page.getByRole("navigation", { name: "文档目录" })).toBeVisible();

  await page.getByRole("navigation", { name: "文档目录" }).getByTitle("取消固定目录").click();
  await expect(page.locator(".note-editor")).not.toHaveClass(/outline-docked-/);
});
