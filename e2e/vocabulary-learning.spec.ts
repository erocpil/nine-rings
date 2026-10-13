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

例句：

- This is an example.
  - 这是例句。

## FreeCollocation 搭配词典

### sample noun

#### 词义 1：example

##### ADJ.

- **small, large | random**
  - A random sample.

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
    if (width < 768) await openDocumentSidebar(page);
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
    await view.locator("summary").filter({ hasText: /^例句$/ }).click();
    await expect(view.getByText("这是例句。", { exact: true })).toBeVisible();
    await view.locator("summary").filter({ hasText: /^例句$/ }).click();
    await expect(view.getByText("这是例句。", { exact: true })).not.toBeVisible();
    await view.locator("summary").filter({ hasText: /^例句$/ }).click();
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
