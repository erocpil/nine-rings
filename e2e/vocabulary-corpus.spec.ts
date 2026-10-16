import { zipSync, strToU8 } from "fflate";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";

const pack = {
  format: "nine-rings-vocabulary", version: 1, id: "test-corpus", name: "测试词库", revision: 1,
  entries: ["alpha", "beta"].map(word => ({
    id: word, word, group: "unit1", addedAt: "2026-10-16T00:00:00Z",
    source: `# ${word}\n\n## 剑桥词典\n\n### ${word} — noun\n\n#### 释义 1\n\nAn example.\n\n例句：\n\n- This is ${word}.\n  - 这是一条例句。\n`,
  })),
};
for (const width of [1280, 390]) test(`独立词库导入、导航、重启恢复不生成文档 ${width}`, async ({ page }) => {
  await createBlankDocument(page, "原文档");
  await closeDocumentSidebar(page);
  const before = await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveVocabularyPreference } = await import("/src/lib/plugin-system/builtin-vocabulary.ts");
    setPluginsEnabled(true);
    saveVocabularyPreference({ enabled: true, path: "references/vocabulary", collapseExamples: true });
    return (await (await import("/src/lib/api.ts")).api.notes.all()).length;
  });
  if (width === 1280) {
    await page.keyboard.press("Alt+,");
    await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
    await page.getByRole("complementary", { name: "插件列表" }).getByRole("button", { name: "词汇学习", exact: true }).click();
    const config = page.getByRole("dialog", { name: "词汇学习配置" });
    await config.getByLabel("选择词库文件").setInputFiles({ name: "words.zip", mimeType: "application/zip", buffer: Buffer.from([0x50, 0x4b, 3, 4, 0xff]) });
    await expect(config.getByRole("alert")).toContainText("ZIP");
    await expect(config.getByLabel("选择词库文件")).toBeEnabled();
    await config.getByLabel("选择词库文件").setInputFiles({ name: "test.nrvocab.json.gz", mimeType: "application/gzip", buffer: gzipSync(Buffer.from(JSON.stringify(pack))) });
    await page.getByRole("button", { name: "导入词库", exact: true }).click();
    await expect(config).toContainText("测试词库 · 2 词");
    const downloading = page.waitForEvent("download");
    await config.getByRole("button", { name: "导出词库", exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe("test-corpus.nrvocab.json");
    await config.getByLabel("选择词库文件").setInputFiles({ name: "zip-corpus.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
      "zip-corpus/unit2/gamma.md": strToU8(pack.entries[0].source.replaceAll("alpha", "gamma")),
    })) });
    await page.getByRole("button", { name: "导入词库", exact: true }).click();
    await expect(config).toContainText("zip-corpus · 1 词");
    await config.getByLabel("选择词库文件").setInputFiles({ name: "zip-corpus.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({
      "zip-corpus/unit2/gamma.md": strToU8(pack.entries[0].source.replaceAll("alpha", "gamma") + "\nUpdated."),
    })) });
    await expect(page.getByRole("dialog", { name: "更新独立词库" })).toContainText("修改 1");
    await page.getByRole("button", { name: "导入词库", exact: true }).click();
    const zipRow = config.locator(".vocabulary-corpus-row").filter({ hasText: "zip-corpus" });
    await expect(zipRow).toContainText("v2");
    await zipRow.getByRole("button", { name: "卸载词库", exact: true }).click();
    await page.getByRole("dialog", { name: "卸载独立词库" }).getByRole("button", { name: "卸载词库", exact: true }).click();
    await expect(zipRow).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  } else {
    await page.evaluate(async pack => (await import("/src/lib/vocabulary/corpus-store.ts")).importCorpus(pack), pack);
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".app")).toHaveClass(/app-mobile-workspace/);
    await expect(page.locator(".app-sidebar")).toHaveAttribute("role", "dialog");
    await openDocumentSidebar(page);
  }
  await page.getByRole("button", { name: "词汇学习", exact: true }).click();
  const panel = page.getByRole("region", { name: "词汇学习分栏", exact: true });
  await panel.getByRole("button", { name: "alpha", exact: true }).click();
  const view = page.getByRole("region", { name: "词汇学习视图" });
  await expect(view).toContainText("An example.");
  await expect(view.getByRole("button", { name: "普通文档", exact: true })).toHaveCount(0);
  await view.getByRole("button", { name: "后一单词", exact: true }).click();
  await expect(view).toHaveAttribute("data-word-document-id", "vocab:test-corpus:beta");
  const after = await page.evaluate(async () => (await (await import("/src/lib/api.ts")).api.notes.all()).length);
  expect(after).toBe(before);
  await page.reload();
  if (width < 768) await openDocumentSidebar(page);
  const button = page.getByRole("button", { name: "词汇学习", exact: true });
  if (!await panel.isVisible()) await button.click();
  await panel.getByRole("button", { name: "beta", exact: true }).click();
  await expect(view).toHaveAttribute("data-word-document-id", "vocab:test-corpus:beta");
});
