import { expect, test } from "@playwright/test";

// Storage-independent component coverage for browser engines whose test
// environment cannot persist IndexedDB Blobs. Real reading flows are separate.
test.use({ hasTouch: true });
for (const format of ["PDF", "EPUB"] as const) {
  test(`${format} 阅读工具栏触屏与键盘边界（独立组件）`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await page.evaluate(async (format) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const React: typeof import("react") = (await load("/node_modules/.vite/deps/react.js")).default;
      const { createRoot }: typeof import("react-dom/client") = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { ReaderToolbar }: typeof import("../src/components/ReaderToolbar") = await load("/src/components/ReaderToolbar.tsx");
      const h = React.createElement;
      function Harness() {
        const [panel, setPanel] = React.useState<import("../src/components/ReaderToolbar").ReaderToolPanel>(null);
        const [value, setValue] = React.useState(100);
        const [query, setQuery] = React.useState("");
        const [notice, setNotice] = React.useState("");
        const [fullscreen, setFullscreen] = React.useState(false);
        return h("div", { className: `pdf-reader ${fullscreen ? "pdf-reader-fullscreen" : ""}` },
          h(ReaderToolbar, {
            format, title: "测试阅读工具栏", activePanel: panel, onPanelChange: setPanel, notice,
            onClose: () => { document.body.dataset.readerClosed = "true"; },
            libraryActions: h("button", { onClick: () => setNotice("已保存书签") }, "测试书签"),
            focusAction: h("button", { className: "pdf-fullscreen-button", onClick: () => setFullscreen(!fullscreen) }, fullscreen ? "测试退出专注" : "测试专注"),
            navigation: h("div", { className: "pdf-page-controls" }, h("button", null, "上一页"), h("span", null, "1/2"), h("button", null, "下一页")),
            search: h("form", { className: "pdf-search", onSubmit: (event) => event.preventDefault() }, h("input", { "aria-label": "测试查询", value: query, onChange: (event) => setQuery(event.target.value) }), h("button", null, "查找")),
            appearance: h("div", { className: "reader-tool-section" }, h("p", null, "测试字号"), h("button", { onClick: () => setValue(value + 10) }, `${value}%`)),
          }),
          h("div", { "data-testid": "reader-content", style: { flex: 1, minHeight: 0, overflow: "auto" } }, h("p", null, "阅读内容")),
        );
      }
      const host = document.createElement("div");
      host.dataset.testid = "reader-toolbar-harness";
      Object.assign(host.style, { display: "flex", position: "fixed", inset: "0", zIndex: "99999", overflow: "hidden" });
      document.body.append(host);
      createRoot(host).render(h(React.StrictMode, null, h(Harness)));
    }, format);
    const host = page.getByTestId("reader-toolbar-harness");
    const settings = host.getByRole("button", { name: `${format} 阅读设置`, exact: true });
    const search = host.getByRole("button", { name: `${format} 搜索`, exact: true });
    const body = page.getByTestId("reader-content");
    const before = await body.boundingBox();
    await settings.tap();
    await host.getByRole("button", { name: "100%", exact: true }).tap();
    await expect(host.getByRole("button", { name: "110%", exact: true })).toBeVisible();
    expect(await body.boundingBox()).toEqual(before);
    await search.tap();
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await expect(host.getByLabel("测试查询")).toBeFocused();
    await host.getByLabel("测试查询").fill("保留查询");
    await page.setViewportSize({ width: 390, height: 360 });
    const searchPanel = host.getByRole("region", { name: `${format} 搜索`, exact: true });
    const rect = await searchPanel.boundingBox();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(360);
    await page.keyboard.press("Escape");
    await expect(searchPanel).toBeHidden();
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => document.body.dataset.readerClosed)).toBeUndefined();
    await page.setViewportSize({ width: 390, height: 800 });
    await settings.tap();
    await host.getByRole("button", { name: "关闭阅读工具面板", exact: true }).tap({ position: { x: 10, y: 500 } });
    await expect(settings).toHaveAttribute("aria-expanded", "false");
    await expect(settings).toBeFocused();
    await search.tap();
    await expect(host.getByLabel("测试查询")).toHaveValue("保留查询");
    await host.getByRole("button", { name: "测试书签", exact: true }).tap();
    await expect(host.getByRole("status")).toHaveText("已保存书签");
    expect(await body.boundingBox()).toEqual(before);
    await settings.tap();
    await host.getByRole("button", { name: "测试专注", exact: true }).tap();
    await expect(host.getByRole("region", { name: `${format} 阅读设置`, exact: true })).toBeHidden();
    await expect(host.getByRole("button", { name: "测试退出专注", exact: true })).toBeVisible();
    await host.getByRole("button", { name: "测试退出专注", exact: true }).tap();
    await expect(settings).toHaveAttribute("aria-expanded", "false");
  });
}
