import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const mode of ["edit", "readonly", "virtual", "source"] as const) {
  test(`提示引用配色、留白和高亮：${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.addInitScript(mode => {
      localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual"));
      localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "paper" }));
    }, mode);
    await createBlankDocument(page, "引用配色验证");
    await page.locator(".ProseMirror:visible").evaluate(async element => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta("> 普通引用\n\n" + ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"].map(kind => `> [!${kind}]\n> 引用正文 ${kind}`).join("\n\n") + "\n\n结束")), true);
    });
    await waitForSavedText(page, "结束");
    if (mode === "readonly" || mode === "virtual") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "source") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const button = page.getByRole("button", { name: "并排预览", exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    }
    const body = page.locator(mode === "source" ? ".markdown-preview-scroll" : mode === "virtual" ? ".vr-body" : ".note-editor .editor-content");
    const alerts = body.locator('blockquote[data-alert]:not([data-alert=""])');
    await expect(alerts).toHaveCount(5);
    await expect(page.locator("html")).toHaveAttribute("data-quote-alert-colors", "semantic");
    const colors = await alerts.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderLeftColor));
    expect(new Set(colors).size).toBe(5);
    const quote = alerts.first();
    const content = quote.locator(".blockquote-content");
    const inset = () => content.evaluate(node => getComputedStyle(node).paddingLeft);
    await expect.poll(inset).toBe("16px");
    await expect(quote.locator(".structured-block-caption")).toHaveText("提示");
    await expect(quote.locator(".structured-block-caption")).toHaveCSS("color", colors[0]);
    if (mode === "edit") {
      for (const style of ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
        for (const theme of ["light", "dark"]) {
          await page.evaluate(async ({ style, theme }) => {
            const { applyInterfaceStyle } = await import("/src/lib/interface-style.ts");
            const { applyTheme } = await import("/src/lib/theme.ts");
            applyInterfaceStyle(style);
            applyTheme(theme);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }, { style, theme });
          await expect.poll(() => alerts.evaluateAll(async nodes => {
            const { quoteContrast } = await import("/src/lib/quote-alert-colors.ts");
            const { normalizeEditorColor } = await import("/src/lib/editor-color.ts");
            return Math.min(...nodes.map(node => {
              const styles = getComputedStyle(node);
              // Resolve color-mix into sRGB before measuring.
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const ctx = canvas.getContext("2d")!;
              ctx.fillStyle = styles.backgroundColor;
              ctx.fillRect(0, 0, 1, 1);
              const rgba = ctx.getImageData(0, 0, 1, 1).data;
              const bg = "#" + Array.from(rgba).slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join("");
              return quoteContrast(normalizeEditorColor(styles.borderLeftColor)!, bg);
            }));
          })).toBeGreaterThanOrEqual(4.4);
        }
      }
    }
    if (mode === "edit") {
      const resting = await quote.evaluate(node => getComputedStyle(node).backgroundColor);
      await content.locator("p").click();
      await expect(quote).toHaveClass(/ProseMirror-activeline/);
      expect(await quote.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(resting);
    }
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } = await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ quoteAlertColors: "style" });
    });
    await expect(page.locator("html")).toHaveAttribute("data-quote-alert-colors", "style");
    await expect.poll(() => alerts.evaluateAll(nodes => new Set(nodes.map(node => getComputedStyle(node).borderLeftColor)).size)).toBe(1);
    if (mode !== "source") {
      await page.setViewportSize({ width: 390, height: 850 });
      await expect.poll(inset).toBe("12px");
    }
  });
}
