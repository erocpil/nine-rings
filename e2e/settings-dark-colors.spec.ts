import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`深色设置的选中按钮和开关使用柔和配色 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    // Use actual shared settings controls; all theme selectors must override
    // the legacy white-on-accent styles, including typography's child dialog.
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ "/src/components/SettingsPanel.tsx");
      const root = document.createElement("div"); root.id = "dark-color-test";
      root.innerHTML = '<div class="settings-panel"><button class="settings-radio active">宽幅</button><button class="settings-btn-primary">保存</button><button class="settings-update-apply">保存并刷新</button><label class="settings-toggle"><input type="checkbox" checked /><span class="toggle-track"></span></label></div><div class="editor-appearance-panel"><button class="settings-btn-primary">应用排版</button></div>';
      document.body.append(root);
    });
    for (const theme of ["dark", "azure-dark", "nord", "dracula"]) {
      for (const style of theme === "dark" ? ["classic", "wabi-sabi", "calm", "paper", "minimal", "nine-rings", "mono-aware", "yugen"] : ["classic"]) {
        await page.evaluate(({ theme, style }) => {
          document.documentElement.className = `theme-${theme} theme-switching`;
          document.documentElement.dataset.interfaceStyle = style;
        }, { theme, style });
        const colors = await page.locator("#dark-color-test button").evaluateAll(buttons => buttons.map(button => {
          const css = getComputedStyle(button);
          const sample = document.createElement("canvas").getContext("2d")!;
          const channels = (color: string) => { sample.fillStyle = color; sample.fillRect(0, 0, 1, 1); return [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          return { text: channels(css.color), fill: channels(css.backgroundColor), css: `${button.className}: ${css.color} / ${css.backgroundColor}` };
        }));
        for (const color of colors) {
          expect(Math.min(...color.text), `${theme}/${style} white text ${color.css}`).toBeLessThan(225);
          expect(Math.max(...color.fill), `${theme}/${style} bright fill`).toBeLessThan(160);
          const lum = (rgb: number[]) => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          expect((lum(color.text) + 0.05) / (lum(color.fill) + 0.05), `${theme}/${style} text contrast`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
}
