import { expect, test, type Page } from "@playwright/test";

const paper = "nine-rings.builtin-theme/paper", calm = "nine-rings.builtin-theme/calm";
async function advanced(page: Page) {
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
}
async function color(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
}
for (const width of [390, 1280]) {
  test(`主题资源浅深配对、排版覆盖与停用回退 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "yugen", interface_color_mode: "system", interface_font_size: 19, editor_h1_font_size: 31, editor_code_font_family: "serif", editor_code_font_size: 21 }));
    });
    await page.goto("/");
    await expect(page.locator(".note-editor")).toBeVisible();
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const note = await api.notes.create(buildTextImportInput({ fileName: "主题测试.md", source: "# 标题保持自定义字号\n\n> 引用默认字体\n\n```js\nconst theme = 1;\n```\n\n" + Array.from({ length: 40 }, (_, i) => `段落 ${i}：主题切换保留实例。`).join("\n\n") }, { mode: "document", storagePath: "ideas", date: "2026-10-17" }));
      useNotesStore.getState().selectNote(note);
    });
    const body = page.locator(".note-editor .ProseMirror");
    await expect(body.locator("h1")).toHaveCSS("font-size", "31px");
    await body.evaluate(element => element.setAttribute("data-theme-session-test", "retained"));
    const config = await page.evaluate(() => localStorage.getItem("nine_rings_config"));
    const code = body.locator(".code-block-inner");
    await expect(code).toHaveCSS("font-size", "21px");
    const originalCodeFont = await code.evaluate(element => getComputedStyle(element).fontFamily);
    await expect.poll(() => color(page)).toBe("#f2f5f6");
    await advanced(page);
    await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
    const list = page.getByRole("complementary", { name: "插件列表", exact: true });
    const enabled = list.getByRole("checkbox", { name: "启用风格主题", exact: true });
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", paper);
    await expect.poll(() => color(page)).toBe("#f8f2e5");
    await list.getByRole("button", { name: "风格主题", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "风格主题配置", exact: true });
    await expect(dialog.locator(".plugin-theme-preview")).toHaveCount(2);
    await expect(dialog).toContainText("无需文档读写权限");
    const paletteSelect = dialog.getByRole("combobox", { name: "配色资源", exact: true });
    await expect(paletteSelect.locator("option")).toHaveCount(7);
    for (const [id, light, dark] of [
      ["paper", "#f8f2e5", "#1b1b1b"], ["calm", "#e8f0e3", "#202c23"],
      ["minimal", "#fafafa", "#202226"], ["nine-rings", "#f0ebf5", "#37313f"],
      ["mono-aware", "#faf4f3", "#292327"], ["yugen", "#f2f5f6", "#18232f"],
      ["wabi-sabi", "#f4f0e6", "#282820"],
    ]) {
      await paletteSelect.selectOption(`nine-rings.builtin-theme/${id}`);
      await page.emulateMedia({ colorScheme: "light" });
      await expect.poll(() => color(page)).toBe(light);
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(() => color(page)).toBe(dark);
      await expect(body).toHaveAttribute("data-theme-session-test", "retained");
    }
    await page.emulateMedia({ colorScheme: "light" });
    await dialog.getByRole("combobox", { name: "配色资源", exact: true }).selectOption(calm);
    await expect.poll(() => color(page)).toBe("#e8f0e3");
    await dialog.getByRole("checkbox", { name: "使用主题排版建议", exact: true }).check();
    await dialog.getByRole("combobox", { name: "配色资源", exact: true }).selectOption(paper);
    await expect(body.locator(".blockquote-content")).toHaveCSS("font-family", /Songti|Serif|serif/);
    await expect(body).toHaveAttribute("data-theme-session-test", "retained");
    await expect(body.locator("h1")).toHaveCSS("font-size", "31px");
    await expect(body).toHaveCSS("font-size", "19px");
    await expect(code).toHaveCSS("font-family", originalCodeFont);
    await expect(code).toHaveCSS("font-size", "21px");
    expect(await page.evaluate(() => localStorage.getItem("nine_rings_config"))).toBe(config);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => color(page)).toBe("#1b1b1b");
    await expect(page.locator("html")).toHaveAttribute("data-interface-style", "yugen");
    await dialog.getByRole("button", { name: "关闭插件配置", exact: true }).click();
    await enabled.uncheck();
    await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
    await expect.poll(() => color(page)).toBe("#18232f");
    await expect(body).toHaveAttribute("data-theme-session-test", "retained");
    await enabled.check();
    await expect.poll(() => color(page)).toBe("#1b1b1b");
    await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).uncheck();
    await expect.poll(() => color(page)).toBe("#18232f");
    await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
    await expect.poll(() => color(page)).toBe("#1b1b1b");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", paper);
    await expect.poll(() => color(page)).toBe("#1b1b1b");
    await expect(page.locator(".note-editor .ProseMirror h1")).toHaveCSS("font-size", "31px");
  });
}

test("主题配置跨窗口同步，资源缺失保留选择并回退", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await advanced(page);
  await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
  await page.getByRole("checkbox", { name: "启用风格主题", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", paper);
  await page.getByRole("button", { name: "风格主题", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "风格主题配置", exact: true });
  const peer = await context.newPage();
  try {
    await peer.goto("/");
    await peer.evaluate(() => localStorage.setItem("nr:pluginTheme", JSON.stringify({ enabled: true, themeId: "missing.provider/theme", typography: true })));
    await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
    await expect(dialog).toContainText("所选资源缺失");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nr:pluginTheme")!).themeId)).toBe("missing.provider/theme");
    await peer.evaluate(id => localStorage.setItem("nr:pluginTheme", JSON.stringify({ enabled: true, themeId: id, typography: false })), calm);
    await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", calm);
    await expect(dialog.getByRole("combobox", { name: "配色资源", exact: true })).toHaveValue(calm);
    await peer.evaluate(() => localStorage.setItem("nr:pluginTheme", "corrupt"));
    await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
  } finally { await peer.close(); }
});

test("经典命名深色主题使用对应资源变体且保留排版与宿主主题", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "classic", theme: "nord", note_font_size: 22 })));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  const original = await color(page);
  const config = await page.evaluate(() => localStorage.getItem("nine_rings_config"));
  await advanced(page);
  await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
  await page.getByRole("checkbox", { name: "启用风格主题", exact: true }).check();
  await expect.poll(() => color(page)).toBe("#1b1b1b");
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  await expect(page.locator(".ProseMirror")).toHaveCSS("font-size", "22px");
  expect(await page.evaluate(() => localStorage.getItem("nine_rings_config"))).toBe(config);
  await page.getByRole("checkbox", { name: "启用风格主题", exact: true }).uncheck();
  await expect.poll(() => color(page)).toBe(original);
});

test("主题排版建议重测局部只读长文档，保留视口与原文", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const { id, content } = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const { setReadonlyRenderingEnabled } = await load("/src/lib/readonly-rendering.ts");
    const source = "# 主题排版阅读\n\n" + Array.from({ length: 100 }, (_, i) => `> Quote ${i}: ${"Typography changes should preserve the reader's position and original content. ".repeat(7)}\n\n段落 ${i}。`).join("\n\n");
    let note = await api.notes.create(buildTextImportInput({ fileName: "主题排版阅读.md", source }, { mode: "document", storagePath: "ideas", date: "2026-10-17" }));
    note = await api.notes.update(note.id, { readonly: true });
    setReadonlyRenderingEnabled(true);
    useNotesStore.getState().selectNote(note);
    return { id: note.id, content: JSON.stringify(note.content) };
  });
  const reader = page.locator("[data-virtual-reader=true]");
  await expect(reader).toBeVisible();
  await reader.evaluate(element => element.setAttribute("data-theme-session-test", "retained"));
  const root = reader.locator(".note-editor-scroll");
  await root.evaluate(element => { element.scrollTop = 2000; });
  await expect.poll(() => reader.locator('[data-reading-row][data-block-type="paragraph"]').evaluateAll(elements => elements.filter(element => {
    const bounds = element.getBoundingClientRect(), viewport = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
  }).length)).toBeGreaterThan(0);
  const number = await reader.locator('[data-reading-row][data-block-type="paragraph"]').evaluateAll(elements => {
    const target = elements.find(element => { const bounds = element.getBoundingClientRect(), viewport = element.closest(".note-editor-scroll")!.getBoundingClientRect(); return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom; });
    return target!.getAttribute("data-block-number")!;
  });
  await advanced(page);
  await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
  await page.getByRole("checkbox", { name: "启用风格主题", exact: true }).check();
  await page.getByRole("button", { name: "风格主题", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "风格主题配置", exact: true });
  const typography = dialog.getByRole("checkbox", { name: "使用主题排版建议", exact: true });
  for (const checked of [true, false, true]) {
    await typography.setChecked(checked);
    await expect(reader).toHaveAttribute("data-theme-session-test", "retained");
    await expect(reader.locator(`[data-reading-row][data-block-number="${number}"]`)).toBeInViewport();
    await expect.poll(() => reader.locator("[data-reading-row]").count()).toBeLessThan(80);
  }
  await dialog.getByRole("button", { name: "关闭插件配置", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
  await advanced(page);
  await page.getByRole("button", { name: "风格主题", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "使用主题排版建议", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "关闭插件配置", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(reader).toBeVisible();
  await expect(reader.locator(`[data-reading-row][data-block-number="${number}"]`)).toBeInViewport();
  expect(await page.evaluate(async id => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    return JSON.stringify((await api.notes.get(id)).content);
  }, id)).toBe(content);
});
