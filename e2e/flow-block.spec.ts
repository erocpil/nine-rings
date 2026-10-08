import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import type { Editor } from "@tiptap/core";

const source = "## 明确问题\n\n*目的：明确边界。*\n\n- 操作一\n- 操作二\n\n> 引用说明，不应打断虚线。\n\n### 条件分支\n\n信息不足时返回。\n\n## 验证结果\n\n| 项目 | 状态 |\n| --- | --- |\n| 主线 | 完成 |\n\n- [ ] 记录结果";

for (const width of [1280, 390]) {
  test(`flow 块连续主线、折叠及源码预览保持一致 ${width}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "paper" })));
    await createBlankDocument(page, "流程块回归");
    const editor = page.locator(".note-editor .ProseMirror").first();
    await editor.evaluate((element, text) => {
      const instance = (element as HTMLElement & { editor: Editor }).editor;
      instance.commands.setContent({ type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "流程前" }] },
        { type: "codeBlock", attrs: { language: "flow" }, content: [{ type: "text", text }] },
        { type: "paragraph", content: [{ type: "text", text: "流程后" }] },
      ] }, true);
    }, source);
    await waitForSavedText(page, "引用说明");
    await page.setViewportSize({ width, height: 850 });
    if (width < 769) {
      await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 400 } });
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("opacity", "0");
    }
    const block = page.locator(".editor-content-shell .flow-block-wrap").first();
    const flow = block.locator(".flow-block-content");
    await expect(flow.locator(".flow-step")).toHaveCount(2);
    const geometry = async () => flow.evaluate(element => {
      const track = element.querySelector(".flow-stages")!;
      const rect = track.getBoundingClientRect();
      const line = getComputedStyle(track, "::before");
      const quote = element.querySelector("blockquote")!.getBoundingClientRect();
      const branch = element.querySelector("h3")!.getBoundingClientRect();
      const circle = element.querySelector(".flow-step-number")!.getBoundingClientRect();
      return { lineHeight: parseFloat(line.height), trackHeight: rect.height, lineTop: parseFloat(line.top), lineBottom: parseFloat(line.bottom), quoteLeft: quote.left - rect.left, branchLeft: branch.left - rect.left, circleRight: circle.right - rect.left, font: getComputedStyle(element).fontSize };
    });
    const rendered = await geometry();
    expect(rendered.lineHeight).toBeCloseTo(rendered.trackHeight - rendered.lineTop - rendered.lineBottom, 0);
    expect(rendered.quoteLeft).toBeGreaterThan(rendered.circleRight);
    expect(rendered.branchLeft).toBeGreaterThan(rendered.circleRight);
    await block.getByRole("button", { name: "折叠流程块", exact: true }).click();
    await expect(flow).toBeHidden();
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    await expect(flow).toBeHidden();
    await block.getByRole("button", { name: "展开流程块", exact: true }).click();
    await expect(flow).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`flow-block-${width}.png`) });
    if (width === 1280) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      if (!await page.locator(".markdown-preview-scroll").count()) await page.getByRole("button", { name: "并排预览", exact: true }).click();
      const preview = page.locator(".markdown-preview-scroll .flow-block-content");
      await expect(preview.locator(".flow-step")).toHaveCount(2);
      const previewMetrics = await preview.evaluate(element => ({ font: getComputedStyle(element).fontSize, branchMargin: getComputedStyle(element.querySelector("h3")!).marginTop }));
      expect(previewMetrics.font).toBe(rendered.font);
      expect(previewMetrics.branchMargin).toBe("20px");
      await page.screenshot({ path: testInfo.outputPath("flow-source-preview.png") });
    }
  });
}

test("flow 块模式修改、实时预览、撤销和多个流程块导航", async ({ page }) => {
  await createBlankDocument(page, "流程块编辑");
  const editor = page.locator(".note-editor .ProseMirror").first();
  await editor.evaluate((element, text) => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "codeBlock", attrs: { language: "flow" }, content: [{ type: "text", text }] },
      { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const n = 1;" }] },
      { type: "codeBlock", attrs: { language: "flow" }, content: [{ type: "text", text: "## 第二个流程\n\n第二份内容。" }] },
    ] }, true);
  }, source);
  await page.getByRole("button", { name: "放大阅读流程块", exact: true }).first().click();
  const dialog = page.locator(".block-workspace");
  await expect(dialog.locator(".flow-step")).toHaveCount(2);
  await dialog.getByRole("button", { name: "切换到编辑模式", exact: true }).click();
  const code = dialog.locator(".cm-content");
  await expect(code).toBeEditable();
  await code.fill("## 修改后的流程\n\n保留撤销与自动保存。");
  await expect(dialog.locator(".flow-workspace-preview h2")).toHaveText("修改后的流程");
  await waitForSavedText(page, "保留撤销");
  await dialog.getByRole("button", { name: "切换到阅读模式", exact: true }).click();
  await expect(dialog.locator(".flow-step")).toHaveCount(1);
  await dialog.getByRole("button", { name: "下一个流程块", exact: true }).click();
  await expect(dialog.locator(".flow-step h2")).toHaveText("第二个流程");
  await dialog.getByRole("button", { name: "关闭块工作区", exact: true }).click();
  await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.undo());
  await expect(editor.locator(".flow-block-content").first().locator(".flow-step")).toHaveCount(2);
});

test("工具栏插入与粘贴 flow、刷新及局部只读保持源文和折叠状态", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nr:experimentalReadonlyRendering", "true"));
  await createBlankDocument(page, "流程插入验证");
  const editor = page.locator(".note-editor .ProseMirror").first();
  await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
  await page.getByRole("button", { name: "插入流程块", exact: true }).click();
  await expect(editor.locator(".flow-step")).toHaveCount(2);
  await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.undo());
  await expect(editor.locator(".flow-block-wrap")).toHaveCount(0);
  await editor.evaluate((element, text) => {
    const data = new DataTransfer(); data.setData("text/plain", `\`\`\`flow\n${text}\n\`\`\``);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, source);
  await expect(editor.locator(".flow-step")).toHaveCount(2);
  await waitForSavedText(page, "引用说明");
  await page.reload();
  await expect(page.locator(".flow-block-content .flow-step")).toHaveCount(2);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(page.locator(".vr-note")).toBeVisible();
  await expect(page.locator(".flow-block-content .flow-step")).toHaveCount(2);
  await page.getByRole("button", { name: "折叠流程块", exact: true }).click();
  await expect(page.locator(".flow-block-content")).toBeHidden();
  await page.getByRole("button", { name: "设为可编辑", exact: true }).click();
  await expect(page.locator(".flow-block-content")).toBeHidden();
  await page.getByRole("button", { name: "展开流程块", exact: true }).click();
  await expect(page.locator(".flow-block-content .flow-step")).toHaveCount(2);
});
