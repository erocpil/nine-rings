import { expect, test } from "@playwright/test";

for (const native of [false, true]) {
  test(`${native ? "Tauri 窗口 API 模拟" : "Web"}：桌面分栏不随专注模式缩小，搜索固定在设置上方`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    // Finish browser-store initialization in both independently loaded panes
    // before installing native presentation mocks (which do not implement DB IPC).
    const tools = page.locator(".doc-tree-toolbar-host button");
    await expect(tools.first()).toBeVisible();
    if (native) {
      // Presentation contract only: retain the initialized browser test store,
      // then use the SDK's official window/IPC mocks. This is not SQLite or a
      // real Windows WebView2/installer test.
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { mockIPC, mockWindows } = await load("/node_modules/@tauri-apps/api/mocks.js") as typeof import("@tauri-apps/api/mocks");
        let fullscreen = false;
        mockWindows("main");
        mockIPC((command, args) => {
          if (command === "plugin:window|is_fullscreen") return fullscreen;
          if (command === "plugin:window|set_fullscreen") fullscreen = Boolean((args as { value: boolean }).value);
          return null;
        }, { shouldMockEvents: true });
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
        const note = useNotesStore.getState().selectedNote!;
        useNotesStore.setState({ selectedNote: { ...note } });
      });
      await expect(page.locator(".titlebar")).toBeVisible();
      await page.locator(".titlebar").getByRole("button", { name: "进入全屏", exact: true }).click();
      await page.locator(".titlebar").getByRole("button", { name: "退出全屏", exact: true }).click();
    } else await expect(page.locator(".titlebar")).toHaveCount(0);

    await expect(page.locator(".app-header")).toHaveCount(0);
    const rail = page.getByRole("navigation", { name: "工作区面板" });
    const geometry = () => rail.getByRole("button").evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute("aria-label"), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    const baseline = await geometry();
    expect(baseline.map(button => button.label)).toEqual(["文档树", "文档列表", "PDF / EPUB 阅读", "全局搜索", "设置"]);
    expect(baseline.every(button => button.width === 36 && button.height === 36)).toBe(true);
    expect(baseline[4].y - baseline[3].y).toBe(42);
    expect(baseline[3].y).toBeGreaterThan(600);
    // The document tree loads independently of the editor; do not capture an
    // empty baseline before its toolbar portal has mounted (notably WebKit).
    await expect(tools.first()).toBeVisible();
    const toolSizes = () => tools.evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect(); return [rect.width, rect.height];
    }));
    const ordinaryToolSizes = await toolSizes();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      expect(await geometry()).toEqual(baseline);
      expect(await toolSizes()).toEqual(ordinaryToolSizes);
      await expect(page.locator(".note-title-row")).toBeVisible();
      await expect(page.locator(".desktop-focus-toolbar")).toHaveCount(0);
      await rail.getByRole("button", { name: "全局搜索" }).click();
      const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
      await expect(dialog.getByRole("textbox", { name: "全局搜索" })).toBeFocused();
      await dialog.getByRole("button", { name: "关闭全局搜索" }).click();
      await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
      expect(await geometry()).toEqual(baseline);
    }
    await rail.getByRole("button", { name: "文档树", exact: true }).click();
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
    await rail.getByRole("button", { name: "文档树", exact: true }).click();
    await expect(page.locator(".app-sidebar")).not.toHaveClass(/sidebar-hidden/);
    await rail.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.locator(".settings-panel")).toBeVisible();
  });
}
