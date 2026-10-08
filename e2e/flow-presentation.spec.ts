import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

for (const width of [1280, 390]) {
  test(`流程示例保持普通正文并在编辑、只读及预览中显示阶段 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".note-editor")).toBeVisible();
    const seed = await page.evaluate(async () => {
      const samplePath = "/src/lib/flow-presentation-sample.ts";
      const apiPath = "/src/lib/api.ts";
      const storePath = "/src/stores/useNotesStore.ts";
      const { ensureFlowPresentationSample, FLOW_SAMPLE_TITLE } = await import(/* @vite-ignore */ samplePath);
      await ensureFlowPresentationSample();
      const { api } = await import(/* @vite-ignore */ apiPath);
      const { useNotesStore } = await import(/* @vite-ignore */ storePath);
      const notes = await api.docs.search({});
      const note = notes.find((item: { title: string }) => item.title === FLOW_SAMPLE_TITLE);
      const legacyPath = "/src/lib/flow-presentation-sample-v1.md?raw";
      const parserPath = "/src/lib/md-parser.ts";
      const { default: markdown } = await import(/* @vite-ignore */ legacyPath);
      const { mdToDelta } = await import(/* @vite-ignore */ parserPath);
      const legacy = await api.notes.create({ date: "2026-10-08", title: "旧版流程兼容", storagePath: "ideas", content: { ...mdToDelta(markdown), metadata: { presentationMode: "flow", flowHeadingLevel: 2 } } });
      useNotesStore.getState().selectNote(legacy);
      const converterPath = "/src/lib/delta-converter.ts";
      const { deltaToProseMirror } = await import(/* @vite-ignore */ converterPath);
      return { id: legacy.id, document: deltaToProseMirror(legacy.content), path: legacy.storagePath };
    });
    expect(seed.path).toBe("ideas");
    if (width < 769 && await page.locator(".sidebar-overlay.active").count()) {
      await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 420 } });
    }
    const stages = page.locator(".note-editor .flow-stage");
    await expect(stages).toHaveCount(3);
    expect(await stages.evaluateAll(elements => elements.map(element => element.getAttribute("data-flow-step")))).toEqual(["1", "2", "3"]);
    const body = page.locator(".note-editor .ProseMirror").first();
    await body.evaluate(element => { (element as HTMLElement & { originalEditor?: Editor; editor: Editor }).originalEditor = (element as HTMLElement & { editor: Editor }).editor; });
    if (width < 769) {
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.getByRole("button", { name: "文档树", exact: true }).click();
    }
    await body.evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      editor.commands.insertContentAt(1, "撤销验证");
    });
    await page.getByTitle("显示属性面板", { exact: true }).click();
    await page.getByLabel("文档展示方式").selectOption("ordinary");
    await page.getByRole("button", { name: "保存展示方式", exact: true }).click();
    await expect(stages).toHaveCount(0);
    await page.getByLabel("文档展示方式").selectOption("flow");
    await page.getByRole("button", { name: "保存展示方式", exact: true }).click();
    await expect(stages).toHaveCount(3);
    expect(await body.evaluate(element => {
      const el = element as HTMLElement & { originalEditor: Editor; editor: Editor };
      return el.originalEditor === el.editor;
    })).toBe(true);
    await page.getByTitle("关闭属性面板", { exact: true }).click();
    await body.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.commands.undo());
    await expect(body).not.toContainText("撤销验证");
    if (width < 769) {
      await page.setViewportSize({ width, height: 850 });
      if (await page.locator(".sidebar-overlay.active").count()) await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 420 } });
    }
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    await expect(stages).toHaveCount(3);
    if (width < 769) {
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("opacity", "0");
      await expect.poll(() => page.locator("#workspace-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`flow-${width}.png`) });
    if (width === 1280) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      if (!(await page.locator(".markdown-preview-scroll").count())) await page.getByRole("button", { name: /并排预览/ }).click();
      await expect(page.locator(".markdown-preview-scroll .flow-stage")).toHaveCount(3);
    }
    await expect.poll(() => page.evaluate(async (id) => {
      const path = "/src/lib/api.ts";
      const { api } = await import(/* @vite-ignore */ path);
      const converterPath = "/src/lib/delta-converter.ts";
      const { deltaToProseMirror } = await import(/* @vite-ignore */ converterPath);
      return deltaToProseMirror((await api.notes.get(id)).content);
    }, seed.id)).toEqual(seed.document);
  });
}

test("局部只读流程保留全局阶段编号和深色配色", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "paper", interface_color_mode: "dark" }));
  });
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(async () => {
    const samplePath = "/src/lib/flow-presentation-sample.ts";
    const apiPath = "/src/lib/api.ts";
    const storePath = "/src/stores/useNotesStore.ts";
    const { ensureFlowPresentationSample, FLOW_SAMPLE_TITLE } = await import(/* @vite-ignore */ samplePath);
    await ensureFlowPresentationSample();
    const { api } = await import(/* @vite-ignore */ apiPath);
    const { useNotesStore } = await import(/* @vite-ignore */ storePath);
    const notes = await api.docs.search({});
    const note = notes.find((item: { title: string }) => item.title === FLOW_SAMPLE_TITLE);
    // Tables intentionally use the complete reader; exercise the virtual reader
    // with a separate, supported flow document instead of weakening its guard.
    const parserPath = "/src/lib/md-parser.ts";
    const { mdToDelta } = await import(/* @vite-ignore */ parserPath);
    const created = await api.notes.create({ date: "2026-10-08", title: "局部流程验证", storagePath: "ideas", content: {
      ...mdToDelta(Array.from({ length: 3 }, (_, index) => `## 阶段 ${index + 1}\n\n${("正文与阶段说明。\n\n").repeat(30)}`).join("\n\n")),
      metadata: { presentationMode: "flow", flowHeadingLevel: 2 },
    } });
    useNotesStore.getState().selectNote(created);
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(page.locator(".vr-note")).toBeVisible();
  const first = page.locator('.vr-note [data-flow-step="1"]');
  await expect(first).toBeVisible();
  const colors = await first.evaluate(element => ({
    circle: getComputedStyle(element, "::before").color,
    accent: getComputedStyle(element).getPropertyValue("--accent").trim(),
  }));
  expect(colors.circle).not.toBe("rgb(0, 0, 0)");
  expect(colors.accent).not.toBe("");
  await page.locator(".vr-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.vr-note [data-flow-step="3"]')).toBeAttached();
});
