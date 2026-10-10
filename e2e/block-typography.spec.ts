import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const style of ["classic", "calm"]) {
  test(`标题和块字体可独立设置，保存、重载、三种视图及恢复默认：${style}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(style => {
      if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style }));
      localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    }, style);
    await createBlankDocument(page, "块排版");
    await page.locator(".ProseMirror:visible").evaluate(async element => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const markdown = Array.from({ length: 6 }, (_, index) => `${"#".repeat(index + 1)} 标题 ${index + 1}`).join("\n\n") + '\n\n```js\nconst number = 1;\n```\n\n> 引用正文\n\n```flow\n## 阶段\n\n流程正文\n```\n\n```mermaid\nflowchart LR\nA[开始] --> B[结束]\n```';
      (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
    });
    await waitForSavedText(page, "标题 6");
    const body = page.locator(".note-editor:visible .editor-content").first();
    const defaultHeading = await body.locator("h1").first().evaluate(element => getComputedStyle(element).fontSize);
    const defaultCode = await body.locator(".code-block-inner").first().evaluate(element => ({ size: getComputedStyle(element).fontSize, family: getComputedStyle(element).fontFamily }));
    expect(defaultCode.family).toContain("monospace");
    const open = async () => {
      await page.getByTitle("设置", { exact: true }).click();
      await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
      await page.getByRole("button", { name: /打开排版设置/ }).click();
    };
    await open();
    await expect(page.getByLabel("H1 字号", { exact: true })).toHaveValue("0");
    for (let level = 1; level <= 6; level++) await page.getByLabel(`H${level} 字号`, { exact: true }).selectOption(String(36 - level));
    for (const [name, family, size] of [["代码块", "monospace", "20"], ["引用块", "serif", "22"], ["图块", "sans", "24"], ["flow 块", "serif", "21"]]) {
      await page.getByLabel(`${name}字体`, { exact: true }).selectOption(family);
      await page.getByLabel(`${name}字号`, { exact: true }).selectOption(size);
    }
    await expect(page.getByLabel("编辑器排版预览").locator("h1")).toHaveCSS("font-size", "35px");
    await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    const check = async (root: typeof body) => {
      for (let level = 1; level <= 6; level++) await expect(root.locator(`h${level}`).first()).toHaveCSS("font-size", `${36 - level}px`);
      await expect(root.locator(".code-block-inner").first()).toHaveCSS("font-size", "20px");
      await expect(root.locator(".blockquote-content").first()).toHaveCSS("font-size", "22px");
      await expect(root.locator(".flow-prose").first()).toHaveCSS("font-size", "21px");
      await expect(root.locator(".mermaid-diagram .nodeLabel").first()).toHaveCSS("font-size", "24px");
    };
    await check(body);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(body.locator("h1").first()).toHaveCSS("font-size", "35px");
    await expect(body.locator(".code-block-inner").first()).toHaveCSS("font-size", "20px");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.reload();
    await check(body);
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    await check(page.locator(".vr-body:visible"));
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const preview = page.getByRole("button", { name: "并排预览", exact: true });
    if (await preview.getAttribute("aria-pressed") !== "true") await preview.click();
    await check(page.locator(".markdown-preview-scroll:visible"));
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await page.getByRole("button", { name: /^(点击)?设为可编辑$/ }).click();
    await open();
    await page.getByRole("button", { name: "恢复默认排版", exact: true }).click();
    await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(body.locator("h1").first()).toHaveCSS("font-size", defaultHeading);
    await expect(body.locator(".code-block-inner").first()).toHaveCSS("font-size", defaultCode.size);
    await expect(body.locator(".code-block-inner").first()).toHaveCSS("font-family", defaultCode.family);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(body.locator("h1").first()).toHaveCSS("font-size", style === "calm" ? "27px" : defaultHeading);
  });
}


test("块字体字号设置在手机和桌面不重叠、不溢出，草稿可应用", async ({ page }) => {
  await createBlankDocument(page, "块字体设置布局");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  const rows = page.locator(".editor-appearance-block-typography .appearance-field");
  await expect(rows).toHaveCount(4);
  for (const width of [320, 390, 844, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["代码块", "引用块", "图块", "flow 块"]) {
      const font = page.getByLabel(`${name}字体`, { exact: true });
      await font.scrollIntoViewIfNeeded();
      const geometry = await font.evaluate(element => {
        const row = element.closest(".appearance-field")!;
        const selects = [...row.querySelectorAll("select")].map(item => item.getBoundingClientRect());
        const bounds = row.getBoundingClientRect();
        const controls = element.closest(".editor-appearance-controls")!;
        return {
          inside: selects.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1),
          separate: selects[0].right <= selects[1].left + 1 || selects[0].bottom <= selects[1].top + 1,
          overflow: controls.scrollWidth - controls.clientWidth,
        };
      });
      expect(geometry.inside, `${width}px ${name}`).toBe(true);
      expect(geometry.separate, `${width}px ${name}`).toBe(true);
      expect(geometry.overflow, `${width}px settings overflow`).toBeLessThanOrEqual(1);
    }
    if (width === 390 || width === 1280) {
      await page.getByRole("heading", { name: "块字体与字号", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`block-typography-${width}.png`) });
    }
  }
  await page.getByLabel("代码块字体", { exact: true }).selectOption("monospace");
  await page.getByLabel("代码块字号", { exact: true }).selectOption("20");
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await expect(page.locator(".editor-appearance-overlay")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config")!).editor_code_font_size)).toBe(20);
});
