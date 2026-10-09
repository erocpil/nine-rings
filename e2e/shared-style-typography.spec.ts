import { expect, test, type Locator } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

const styles = ["calm", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"];

async function expectTypography(root: Locator, size: number, gap: number, before: number, after: number, mobile = false) {
  await expect(root.locator("p").first()).toHaveCSS("font-size", `${size}px`);
  const metrics = await root.evaluate(element => {
    const read = (target: Element) => {
      const style = getComputedStyle(target);
      return { size: parseFloat(style.fontSize), weight: style.fontWeight, spacing: style.letterSpacing, bottom: parseFloat(style.marginBottom) };
    };
    const paragraphs = element.querySelectorAll("p");
    return { first: read(paragraphs[0]), second: read(paragraphs[1]), headings: [1, 2, 3, 4, 5, 6].map(level => read(element.querySelector(`h${level}`)!)) };
  });
  expect(metrics.first.bottom).toBeCloseTo(gap, 1);
  expect(metrics.second.bottom).toBeCloseTo(mobile ? before * 4 / 7 : before, 1);
  const ratios = mobile ? [1.6875, 1.1875, 1.125, 1, 1, 1] : [2.125, 1.3125, 1.125, 1, 1, 1];
  metrics.headings.forEach((heading, index) => {
    expect(heading.size).toBeCloseTo(size * ratios[index], 1);
    expect(heading.weight).toBe("600");
    expect(["normal", "0px"]).toContain(heading.spacing);
    expect(heading.bottom).toBeCloseTo(mobile ? after * 2 / 3 : after, 1);
  });
}

test("切换七种风格保留共享设置，设置预览展示相同排版", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({
      interface_style: "wabi-sabi", interface_font_size: 20, interface_line_height: 1.9,
      interface_block_spacing_px: 22, interface_heading_margin_top_px: 34,
      interface_heading_margin_bottom_px: 14, interface_content_width: 740,
    }));
  });
  await createBlankDocument(page);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const group = page.getByRole("group", { name: "界面风格", exact: true });
  for (const name of ["清雅", "纸页", "精简", "九环", "物哀", "幽玄", "侘寂"]) {
    await group.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator(".note-editor .ProseMirror")).toHaveCSS("font-size", "20px");
    await page.getByRole("button", { name: /打开排版设置/ }).click();
    const preview = page.getByLabel("编辑器排版预览");
    await expect(preview.locator("h1")).toHaveCSS("font-size", "42.5px");
    await expect(preview.locator("h1")).toHaveCSS("font-weight", "600");
    await expect(preview.locator("h1")).toHaveCSS("margin-bottom", "14px");
    await expect(preview.locator("p").first()).toHaveCSS("margin-bottom", "34px");
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
});

for (const style of styles) {
  for (const mode of ["light", "dark"]) {
    test(`${style} ${mode} 共用排版在编辑、手机、只读和源码预览生效`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.addInitScript(({ style, mode }) => {
        if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({
          interface_style: style, interface_color_mode: mode, workspace_layout: "exhibition", exhibition_text_width: "wide",
        }));
      }, { style, mode });
      await createBlankDocument(page, "统一排版验证");
      const editor = page.locator(".note-editor .ProseMirror");
      await editor.evaluate(element => {
        (element as HTMLElement & { editor: Editor }).editor.commands.setContent(
          '<p>统一排版起始正文 <code>inline</code></p><p>标题之前</p>' +
          [1, 2, 3, 4, 5, 6].map(level => `<h${level}>标题 ${level}</h${level}><p>正文 ${level}</p>`).join("") +
          '<blockquote><p>引用正文</p></blockquote><pre><code>const value = 1;</code></pre>', true,
        );
      });
      await expectTypography(editor, 16, 16, 28, 12);
      await waitForSavedText(page, "统一排版起始正文");
      // Persist customized shared settings, then load through the real startup path.
      await page.evaluate(async () => {
        const { api } = await import("/src/lib/api.ts");
        await api.config.set({ interface_font_size: 20, interface_line_height: 1.9,
          interface_block_spacing_px: 22, interface_heading_margin_top_px: 34,
          interface_heading_margin_bottom_px: 14, interface_content_width: 740 });
      });
      await page.reload();
      await expectTypography(editor, 20, 22, 34, 14);
      await expect(editor).toHaveCSS("line-height", "38px");
      await expect.poll(async () => (await page.locator(".editor-content-shell").boundingBox())!.width).toBeLessThanOrEqual(740);
      await page.setViewportSize({ width: 390, height: 850 });
      await expectTypography(editor, 20, 22, 34, 14, true);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
      await expectTypography(editor, 20, 22, 34, 14);
      await page.evaluate(() => {
        localStorage.setItem("nr:experimentalReadonlyRendering", "true");
        window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
      });
      await expectTypography(page.locator(".vr-body"), 20, 22, 34, 14);
      await page.getByRole("button", { name: "源码", exact: true }).click();
      if (!await page.locator(".markdown-preview-scroll").count()) await page.getByRole("button", { name: "并排预览", exact: true }).click();
      await expectTypography(page.locator(".markdown-preview-scroll .ProseMirror"), 20, 22, 34, 14);
    });
  }
}
