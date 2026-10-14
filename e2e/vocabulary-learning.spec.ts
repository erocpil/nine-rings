import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";
const markdown = `# sample

## 剑桥词典

来源：[Cambridge](https://dictionary.cambridge.org/)

### sample — noun

音标：UK /sample/

#### 释义 1

An example.

例子，样本。

例句：

- This is an example.
  - 这是例句。

## FreeCollocation 搭配词典

### sample noun

#### 词义 1：example

##### ADJ.

- **small, large | random**
  - A random sample.
  - Another random sample.

### sample verb

##### PREP.

- **from**
  - Sample from a group.
`;
async function seed(page: Page) {
  await createBlankDocument(page, "原文档");
  await closeDocumentSidebar(page);
  return page.evaluate(async (source) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { setPluginsEnabled } = await load("/src/lib/plugin-system/runtime.ts");
    const { saveVocabularyPreference } = await load("/src/lib/plugin-system/builtin-vocabulary.ts");
    const word = await api.notes.create({ title: "sample", storagePath: "references/vocabulary", content: mdToDelta(source) });
    await api.notes.create({ title: "outside", storagePath: "ideas", content: mdToDelta(source) });
    await api.notes.create({ title: "unknown", storagePath: "references/vocabulary", content: mdToDelta("# unknown\n\nPersonal study note.") });
    setPluginsEnabled(true);
    saveVocabularyPreference({ enabled: true, path: "references/vocabulary", collapseExamples: true });
    return { id: word.id, content: word.content };
  }, markdown);
}
for (const width of [1280, 390]) {
  test(`词汇学习保留来源、原文及原视图，停用撤销 ${width}`, async ({ page }) => {
    const original = await seed(page);
    await page.setViewportSize({ width, height: 844 });
    if (width < 768) {
      await expect(page.locator(".app-sidebar")).toHaveAttribute("aria-label", "文档侧栏");
      await openDocumentSidebar(page);
    }
    await page.getByRole("button", { name: "词汇学习", exact: true }).click();
    const panel = page.getByRole("region", { name: "词汇学习分栏", exact: true });
    await expect(panel.getByRole("button", { name: "sample", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "outside", exact: true })).toHaveCount(0);
    await panel.getByRole("searchbox", { name: "查找词汇" }).fill("samp");
    await expect(panel.getByRole("button", { name: "unknown", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "sample", exact: true }).click();
    const view = page.getByRole("region", { name: "词汇学习视图", exact: true });
    await expect(view).toBeVisible();
    await expect(view.getByRole("heading", { name: "剑桥词典", exact: true })).toBeVisible();
    await expect(view.getByRole("heading", { name: "FreeCollocation 搭配词典", exact: true })).toBeVisible();
    await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
    const examples = view.locator(".vocabulary-category").filter({ has: page.locator('summary[data-vocabulary-fold-label="例句"]') }).first();
    await examples.locator('summary[data-vocabulary-fold-label="例句"]').click();
    await expect(view.getByText("This is an example.", { exact: true })).toBeVisible();
    await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
    await examples.locator('summary[data-vocabulary-fold-label="译文"]').click();
    await expect(view.getByText("这是例句。", { exact: true })).toBeVisible();
    await examples.locator('summary[data-vocabulary-fold-label="例句"]').click();
    await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
    await examples.locator('summary[data-vocabulary-fold-label="例句"]').click();
    await expect(view.getByText("这是例句。", { exact: true })).toBeVisible();
    await examples.locator('summary[data-vocabulary-fold-label="译文"]').click();
    await expect(view.getByText("This is an example.", { exact: true })).toBeVisible();
    await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
    await expect(view.getByText("完整 Markdown 原文", { exact: true })).toHaveCount(0);
    await view.getByText("small, large | random", { exact: true }).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    });
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("small, large | random");
    expect(await page.evaluate(async id => { const { api } = await import("/src/lib/api.ts"); return (await api.notes.get(id))?.content; }, original.id)).toEqual(original.content);
    await view.getByRole("button", { name: "返回原视图", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("原文档");
    if (width < 768) { await openDocumentSidebar(page); await page.getByRole("button", { name: "词汇学习", exact: true }).click(); }
    await panel.getByRole("searchbox", { name: "查找词汇" }).fill("");
    await panel.getByRole("button", { name: "unknown", exact: true }).click();
    await expect(view).toContainText("未识别到词典结构");
    await view.getByRole("button", { name: "普通文档", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("unknown");
    if (width < 768) { await openDocumentSidebar(page); await page.getByRole("button", { name: "词汇学习", exact: true }).click(); }
    await panel.getByRole("button", { name: "sample", exact: true }).click();
    await expect(view).toBeVisible();
    await page.evaluate(async () => { const { saveVocabularyPreference, readVocabularyPreference } = await import("/src/lib/plugin-system/builtin-vocabulary.ts"); saveVocabularyPreference({ ...readVocabularyPreference(), enabled: false }); });
    await expect(page.getByRole("button", { name: "词汇学习", exact: true })).toHaveCount(0);
    await expect(view).toHaveCount(0);
    await expect(page.locator(".note-title")).toHaveValue("unknown");
  });
}

test("词汇插件的路径和折叠选项可配置且刷新保留", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
  const catalog = page.getByRole("complementary", { name: "插件列表", exact: true });
  await catalog.getByRole("button", { name: "词汇学习", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "词汇学习配置", exact: true });
  const path = dialog.getByRole("textbox", { name: "词汇路径", exact: true });
  await expect(path).toHaveValue("references/vocabulary");
  await path.fill("references/english");
  await path.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("已更新");
  await dialog.getByRole("checkbox", { name: "例句默认折叠", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
  await catalog.getByRole("button", { name: "词汇学习", exact: true }).click();
  await expect(path).toHaveValue("references/english");
  await expect(dialog.getByRole("checkbox", { name: "例句默认折叠", exact: true })).not.toBeChecked();
});


test("学习视图真实拖选不包含折叠按钮，卡片与控件不使用文本选区", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await page.getByRole("region", { name: "词汇学习分栏" }).getByRole("button", { name: "sample", exact: true }).click();
  const view = page.getByRole("region", { name: "词汇学习视图" });
  const english = view.getByText("An example.", { exact: true });
  const examples = view.locator('.vocabulary-category summary[data-vocabulary-fold-label="例句"]').first();
  const start = (await english.boundingBox())!;
  const end = (await examples.boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 80, end.y + end.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.screenshot({ path: test.info().outputPath("vocabulary-selection.png") });
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain("An example.");
  expect(selected).toContain("例子，样本。");
  expect(selected).not.toContain("例句");
  expect(selected).not.toContain("This is an example.");
  expect(await examples.evaluate(element => getComputedStyle(element).getPropertyValue("user-select") || getComputedStyle(element).getPropertyValue("-webkit-user-select"))).toBe("none");
  expect(await english.evaluate(element => getComputedStyle(element).getPropertyValue("user-select") || getComputedStyle(element).getPropertyValue("-webkit-user-select"))).toBe("text");
});


test("例句默认展开时译文仍收起，搭配例句与剑桥译文独立控制", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { saveVocabularyPreference, readVocabularyPreference } = await import("/src/lib/plugin-system/builtin-vocabulary.ts");
    saveVocabularyPreference({ ...readVocabularyPreference(), collapseExamples: false });
  });
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await page.getByRole("region", { name: "词汇学习分栏" }).getByRole("button", { name: "sample", exact: true }).click();
  const view = page.getByRole("region", { name: "词汇学习视图" });
  await expect(view.getByText("This is an example.", { exact: true })).toBeVisible();
  await expect(view.getByText("A random sample.", { exact: true })).toBeVisible();
  await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
  await view.locator('summary[data-vocabulary-fold-label="译文"]').click();
  await expect(view.getByText("这是例句。", { exact: true })).toBeVisible();
  await view.locator(".vocabulary-examples summary").first().click();
  await expect(view.getByText("A random sample.", { exact: true })).not.toBeVisible();
  await expect(view.getByText("这是例句。", { exact: true })).toBeVisible();
});


for (const width of [1280, 390]) {
  test(`例句和译文展开保持紧凑，搭配下连续例句无重复卡片 ${width}`, async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width, height: 844 });
    if (width < 768) {
      await expect(page.locator(".app-sidebar")).toHaveAttribute("aria-label", "文档侧栏");
      await openDocumentSidebar(page);
    }
    await page.getByRole("button", { name: "词汇学习", exact: true }).click();
    await page.getByRole("region", { name: "词汇学习分栏" }).getByRole("button", { name: "sample", exact: true }).click();
    const view = page.getByRole("region", { name: "词汇学习视图" });
    const examples = view.locator('.vocabulary-category summary[data-vocabulary-fold-label="例句"]').first();
    await examples.click();
    const english = view.getByText("This is an example.", { exact: true });
    const gap = async (before: typeof english, after: typeof english) => {
      const lineBox = async (locator: typeof english) => locator.evaluate(element => {
        const rect = (element.closest("p") ?? element).getBoundingClientRect();
        return { y: rect.y, height: rect.height };
      });
      const first = await lineBox(before), second = await lineBox(after);
      return second.y - (first.y + first.height);
    };
    expect(await gap(examples, english)).toBeLessThanOrEqual(10);
    const translations = view.locator('summary[data-vocabulary-fold-label="译文"]');
    await translations.click();
    const chinese = view.getByText("这是例句。", { exact: true });
    await expect(chinese).toBeVisible();
    expect(await gap(translations, chinese)).toBeLessThanOrEqual(6);
    const collocationExamples = view.locator(".vocabulary-examples summary").first();
    await collocationExamples.click();
    const first = view.getByText("A random sample.", { exact: true });
    const second = view.getByText("Another random sample.", { exact: true });
    await expect(second).toBeVisible();
    expect(await gap(collocationExamples, first)).toBeLessThanOrEqual(10);
    expect(await gap(first, second)).toBeLessThanOrEqual(12);
    expect(await gap(english, translations)).toBeLessThanOrEqual(6);
    await expect(english.locator("xpath=ancestor::li[1]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const text of [chinese, first]) {
      const content = (await text.locator("xpath=ancestor::p[1]").boundingBox())!, item = (await text.locator("xpath=ancestor::li[1]").boundingBox())!;
      expect(item.height - content.height).toBeLessThanOrEqual(8);
      await expect(text.locator("xpath=ancestor::li[1]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  });
}


test("跨词性标题、释义和展开例句的选区仅着色文字", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await page.getByRole("region", { name: "词汇学习分栏" }).getByRole("button", { name: "sample", exact: true }).click();
  const view = page.getByRole("region", { name: "词汇学习视图" });
  await view.locator('.vocabulary-category summary[data-vocabulary-fold-label="例句"]').first().click();
  const start = (await view.getByRole("heading", { name: "sample — noun", exact: true }).boundingBox())!;
  const end = (await view.getByText("This is an example.", { exact: true }).boundingBox())!;
  await page.mouse.move(start.x + 12, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 18 });
  await page.mouse.up();
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  expect(selection).toContain("An example.");
  expect(selection).toContain("例子，样本。");
  expect(selection).not.toContain("这是例句。");
  expect(selection).not.toContain("译文");
  await expect(view.locator(".vocabulary-entry").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const backgrounds = await view.locator(".vocabulary-entry").first().evaluate(element => ({
    frame: getComputedStyle(element, "::selection").backgroundColor,
    text: getComputedStyle(element.querySelector(".vocabulary-text")!, "::selection").backgroundColor,
    heading: getComputedStyle(element.querySelector("h3")!, "::selection").backgroundColor,
  }));
  expect(backgrounds.frame).toBe("rgba(0, 0, 0, 0)");
  expect(backgrounds.heading).toBe("rgba(0, 0, 0, 0)");
  expect(backgrounds.text).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: test.info().outputPath("vocabulary-cross-selection.png") });
});

for (const style of ["classic", "paper"] as const) test(`学习字号、行高和标题跟随排版设置且修改立即生效 ${style}`, async ({ page }) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style, note_font_size: 22, editor_line_height: 1.8, interface_font_size: 22, interface_line_height: 1.8, editor_h3_font_size: 29 })), style);
  await seed(page);
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await page.getByRole("region", { name: "词汇学习分栏" }).getByRole("button", { name: "sample", exact: true }).click();
  const view = page.getByRole("region", { name: "词汇学习视图" });
  await expect(view.getByText("An example.", { exact: true })).toHaveCSS("font-size", "22px");
  await expect(view.getByRole("heading", { name: "sample — noun", exact: true })).toHaveCSS("font-size", "29px");
  await view.locator('.vocabulary-category summary[data-vocabulary-fold-label="例句"]').first().click();
  await view.locator('summary[data-vocabulary-fold-label="译文"]').click();
  for (const text of ["This is an example.", "这是例句。", "An example."]) {
    const row = view.getByText(text, { exact: true });
    await expect(row).toHaveCSS("font-size", "22px");
    expect(await row.evaluate(element => parseFloat(getComputedStyle(element).lineHeight))).toBeCloseTo(39.6, 3);
  }
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^编辑器/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await page.getByRole("button", { name: style === "classic" ? "增大正文与标题字号" : "增大风格正文字号", exact: true }).click();
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(view.getByText("This is an example.", { exact: true })).toHaveCSS("font-size", "23px");
  await expect(view.getByText("这是例句。", { exact: true })).toHaveCSS("font-size", "23px");
  await expect(view.getByRole("heading", { name: "sample — noun", exact: true })).toHaveCSS("font-size", "29px");
});

test("按单词恢复阅读位置与独立折叠状态，刷新后仍保留", async ({ page }) => {
  const original = await seed(page);
  await page.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const note = await api.notes.get(id);
    const { noteToMarkdown } = await import("/src/lib/markdown-serializer.ts");
    const markdown = noteToMarkdown(note.title, note.content) + "\n\n" + Array.from({ length: 50 }, (_, i) => `#### 释义 ${i + 2}\n\nMeaning ${i + 2}.\n\n解释。`).join("\n\n");
    await api.notes.update(id, { content: mdToDelta(markdown) });
  }, original.id);
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  const panel = page.getByRole("region", { name: "词汇学习分栏" });
  const view = page.getByRole("region", { name: "词汇学习视图" });
  await panel.getByRole("button", { name: "sample", exact: true }).click();
  const examples = view.locator('.vocabulary-category summary[data-vocabulary-fold-label="例句"]').first();
  await examples.click();
  await view.locator('summary[data-vocabulary-fold-label="译文"]').click();
  const root = view.locator(".vocabulary-study-scroll");
  await root.evaluate(element => { element.scrollTop = 480; });
  await expect.poll(() => root.evaluate(element => element.scrollTop)).toBe(480);
  await panel.getByRole("button", { name: "unknown", exact: true }).click();
  await expect(view).toContainText("未识别到词典结构");
  await panel.getByRole("button", { name: "sample", exact: true }).click();
  await expect.poll(() => root.evaluate(element => element.scrollTop)).toBe(480);
  await expect(view.locator(".vocabulary-translations")).toHaveAttribute("open", "");
  const fold = view.locator(".vocabulary-category--examples > details").first();
  await expect(fold).toHaveAttribute("open", "");
  await page.reload();
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await panel.getByRole("button", { name: "sample", exact: true }).click();
  await expect.poll(() => root.evaluate(element => element.scrollTop)).toBe(480);
  await expect(view.locator(".vocabulary-translations")).toHaveAttribute("open", "");
  await expect(fold).toHaveAttribute("open", "");
});

test("排序采用实际添加时间并持久化，提示气泡对齐词汇行且留在屏幕内", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    await api.notes.create({ title: "zulu", storagePath: "references/vocabulary", content: { ops: [] } });
  });
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  const panel = page.getByRole("region", { name: "词汇学习分栏" });
  const rows = panel.locator("li button");
  await expect(rows).toHaveText(["sample", "unknown", "zulu"]);
  await expect(panel.locator(".workspace-panel-title")).toHaveCount(0);
  await panel.getByRole("combobox", { name: "词汇排序" }).selectOption("added");
  await expect(rows.first()).toHaveText("zulu");
  const row = rows.first();
  await row.hover();
  const tooltip = page.getByRole("tooltip", { name: /zulu/ });
  await expect(tooltip).toBeVisible();
  const r = (await row.boundingBox())!, t = (await tooltip.boundingBox())!;
  expect(Math.abs(r.x - t.x)).toBeLessThanOrEqual(1);
  expect(t.x).toBeGreaterThanOrEqual(8);
  expect(t.x + t.width).toBeLessThanOrEqual(1272);
  const refresh = panel.getByRole("button", { name: "刷新词汇列表" });
  await refresh.hover();
  const refreshHint = page.getByRole("tooltip", { name: "刷新词汇列表", exact: true });
  await expect(refreshHint).toBeVisible();
  const rb = (await refresh.boundingBox())!, tb = (await refreshHint.boundingBox())!;
  expect(Math.abs((rb.x + rb.width / 2) - (tb.x + tb.width / 2))).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "词汇排序" })).toHaveValue("added");
  await expect(rows.first()).toHaveText("zulu");
  await panel.getByRole("searchbox", { name: "查找词汇" }).fill("no-such-word");
  await expect(panel.getByRole("status")).toHaveText("没有匹配的词汇");
});
