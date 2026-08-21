import { expect, test } from "@playwright/test";

test("Markdown 可按指定路径和元数据导入为文档", async ({ page }) => {
  const longSection = Array.from(
    { length: 36 },
    (_, index) => `正文段落 ${index + 1}：用于验证目录跳转后的滚动定位。`,
  ).join("\n\n");
  await page.goto("/");
  await page.getByTitle("设置").click();

  await page.getByLabel("Markdown 导入目标路径").fill("references/import-e2e");
  await page.getByLabel("Markdown 导入文档类型").selectOption("tutorial");
  await page.getByLabel("Markdown 导入概念标签").fill("DPDK, 网络");
  await page.getByLabel("Markdown 导入普通标签").fill("imported");

  const input = page.locator('input[type="file"][accept=".md"]');
  await input.setInputFiles({
    name: "review-import.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      `# Imported Review\n\n## VFIO/UIO接入层\n\n${longSection}\n\n### 子项\n\n- **队列初始化**\n  - 完成映射`,
      "utf8",
    ),
  });

  await expect(page.getByText("已导入 1 篇笔记")).toBeVisible();
  await page.locator(".settings-close").click();
  const viewSwitch = page.locator(".sidebar-view-switch");
  if (await viewSwitch.getAttribute("data-target-view") === "tree") await viewSwitch.click();

  await expect(page.locator(".doc-tree-name", { hasText: "references" })).toBeVisible();
  await expect(page.locator(".doc-tree-name", { hasText: "import-e2e" })).toBeVisible();
  const imported = page.locator(".doc-tree-doc", { hasText: "Imported Review" });
  await expect(imported).toBeVisible();
  await imported.click();

  await expect(page.locator(".note-title")).toHaveValue("Imported Review");
  await expect(page.locator(".tag-chip", { hasText: "imported" })).toBeVisible();
  await expect(page.locator(".ProseMirror > ul > li > ul > li")).toHaveText("完成映射");

  // Markdown 空白行作为块分隔符渲染成可见间距，而不是结构性空段落。
  await expect.poll(() => page.locator(".ProseMirror").evaluate((element) => {
    const paragraphs = [...element.querySelectorAll(":scope > p")];
    if (paragraphs.length < 2) return 0;
    const first = paragraphs[0].getBoundingClientRect();
    const second = paragraphs[1].getBoundingClientRect();
    return second.top - first.bottom;
  })).toBeGreaterThanOrEqual(14);

  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await expect(outline).toBeVisible();
  const outlineItems = outline.locator(".document-outline-item");
  await expect(outlineItems).toHaveCount(3);
  await expect(outlineItems.nth(0)).toHaveAttribute("data-level", "1");
  const levelBox = await outlineItems.nth(0).locator(".document-outline-level").boundingBox();
  const textBox = await outlineItems.nth(0).locator(".document-outline-text").boundingBox();
  if (!levelBox || !textBox) throw new Error("outline item geometry not found");
  expect(textBox.x - (levelBox.x + levelBox.width)).toBeLessThanOrEqual(4);
  await expect(outlineItems.nth(1)).toHaveAttribute("data-level", "2");
  await expect(outlineItems.nth(1)).toContainText("VFIO/UIO接入层");
  await expect(outlineItems.nth(2)).toHaveAttribute("data-level", "3");

  await outlineItems.nth(2).click();
  await expect(outline).toHaveCount(0);
  await expect.poll(() => page.locator(".ProseMirror").evaluate((element) => {
    const anchor = window.getSelection()?.anchorNode;
    const heading = anchor instanceof Element ? anchor.closest("h3") : anchor?.parentElement?.closest("h3");
    return heading?.textContent ?? "";
  })).toBe("子项");
  await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
    (element) => (element as HTMLElement).scrollTop,
  )).toBeGreaterThan(100);

  // 专注模式下原始标题会随正文滚走；顶栏文件名接替为同一目录的入口。
  await page.getByTitle("专注模式").click();
  const stickyOutlineTrigger = page.getByRole("button", {
    name: "Imported Review，打开文档目录",
  });
  await expect(stickyOutlineTrigger).toBeVisible();
  await stickyOutlineTrigger.click();
  await expect(outline).toBeVisible();
  await outline.locator(".document-outline-item").nth(1).click();
  await expect.poll(() => page.locator(".ProseMirror").evaluate((element) => {
    const anchor = window.getSelection()?.anchorNode;
    const heading = anchor instanceof Element ? anchor.closest("h2") : anchor?.parentElement?.closest("h2");
    return heading?.textContent ?? "";
  })).toBe("VFIO/UIO接入层");
});
