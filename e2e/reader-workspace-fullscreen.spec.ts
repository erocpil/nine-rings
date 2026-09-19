import { expect, test } from "./helpers/reader-test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";

for (const platform of ["web", "MacIntel", "Win32"]) {
  for (const format of ["PDF", "EPUB"] as const) {
    test(`${platform} ${format}：窗口全屏保持分栏比例，阅读全屏只隐藏文档`, async ({ page }) => {
      test.setTimeout(60000);
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
      await page.evaluate(async platform => {
        document.body.dataset.fullscreenRequests = "0";
        const unexpected = async () => {
          document.body.dataset.fullscreenRequests = String(Number(document.body.dataset.fullscreenRequests) + 1);
        };
        Element.prototype.requestFullscreen = unexpected;
        document.exitFullscreen = unexpected;
        if (platform === "web") return;
        Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { mockIPC, mockWindows } = await load("/node_modules/@tauri-apps/api/mocks.js") as typeof import("@tauri-apps/api/mocks");
        let fullscreen = false;
        mockWindows("main");
        mockIPC((command, args) => {
          if (command === "plugin:window|is_fullscreen") return fullscreen;
          if (command === "set_window_fullscreen" || command === "plugin:window|set_fullscreen") {
            fullscreen = Boolean((args as { fullscreen?: boolean; value?: boolean }).fullscreen ?? (args as { value?: boolean }).value);
            document.body.dataset.nativeFullscreen = String(fullscreen);
            document.body.dataset.fullscreenRequests = String(Number(document.body.dataset.fullscreenRequests) + 1);
          }
          return null;
        }, { shouldMockEvents: true });
        // Keep the initialized browser store while enabling native window UI.
        // The real IndexedDB reader store and real PDF/EPUB renderer remain active.
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
        const note = useNotesStore.getState().selectedNote!;
        useNotesStore.setState({ selectedNote: { ...note } });
      }, platform);
      await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
      await page.locator(`input[accept="${format === "PDF" ? "application/pdf,.pdf" : "application/epub+zip,.epub"}"]`).setInputFiles({
        name: `split.${format.toLowerCase()}`,
        mimeType: format === "PDF" ? "application/pdf" : "application/epub+zip",
        buffer: format === "PDF" ? createPdfFixture() : createEpubFixture(),
      });
      const reader = page.getByLabel(`${format} 阅读器`, { exact: true });
      if (format === "PDF") await expect(page.locator(".pdf-text-layer").first()).toContainText("Nine Rings PDF MVP");
      else await expect(page.frameLocator(".epub-chapter-frame").getByRole("heading", { name: "第一章" })).toBeVisible();
      const sidebar = page.locator(".app-sidebar");
      const editor = page.locator(".app-main");
      const divider = await page.locator(".sidebar-divider").boundingBox();
      await page.mouse.move(divider!.x + 2, divider!.y + 200);
      await page.mouse.down();
      await page.mouse.move(divider!.x + 126, divider!.y + 200, { steps: 5 });
      await page.mouse.up();
      const ratio = () => sidebar.evaluate(el => el.getBoundingClientRect().width / (innerWidth - 48));
      const before = await ratio();
      const originalEditor = await editor.elementHandle();
      if (platform !== "web") await page.locator(".titlebar").getByRole("button", { name: "进入全屏", exact: true }).click();
      await page.setViewportSize({ width: 1600, height: 1000 });
      if (platform !== "web") await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { emit } = await load("/node_modules/@tauri-apps/api/event.js") as typeof import("@tauri-apps/api/event");
        await emit("tauri://resize", { width: 1600, height: 1000 });
      });
      await expect.poll(ratio).toBeCloseTo(before, 2);
      await expect(editor).toBeVisible();
      await expect(reader).not.toHaveClass(/pdf-reader-fullscreen|epub-reader-focus/);
      const expectedRequests = platform === "web" ? "0" : "1";
      await reader.getByRole("button", { name: format === "PDF" ? "进入全屏阅读" : "进入 EPUB 专注模式", exact: true }).click();
      await expect(editor).toBeHidden();
      await expect.poll(async () => (await reader.boundingBox())!.width).toBeCloseTo(1600, 0);
      await expect(page.locator("body")).toHaveAttribute("data-fullscreen-requests", expectedRequests);
      if (platform !== "web") {
        await expect(page.locator(".titlebar")).toBeVisible();
        await expect(page.locator("body")).toHaveAttribute("data-native-fullscreen", "true");
      }
      // Escape returns to the same companion editor and ratio, without exiting
      // the global window fullscreen or remounting the document.
      await page.locator(".desktop-reader-panel").focus();
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      await expect.poll(ratio).toBeCloseTo(before, 2);
      expect(await originalEditor!.evaluate(node => node === document.querySelector(".app-main"))).toBe(true);
      await expect(page.locator("body")).toHaveAttribute("data-fullscreen-requests", expectedRequests);
      if (platform !== "web") await page.locator(".titlebar").getByRole("button", { name: "退出全屏", exact: true }).click();
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(ratio).toBeCloseTo(before, 2);
      await expect(reader).toBeVisible();
    });
  }
}
