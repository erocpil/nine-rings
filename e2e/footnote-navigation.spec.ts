import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

const sample = "### 脚注\n\nMarkdown 支持脚注[^1]，用于补充说明与引用。\n\n" +
  "中间正文。\n\n".repeat(100) +
  "[^1]: 这是一条脚注——点击箭头可返回原处。";

async function insertSample(page: Page) {
  await page.locator(".note-editor .ProseMirror").evaluate(async (element, markdown) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
  }, sample);
  await waitForSavedText(page, "中间正文");
}

test("编辑视图脚注双向跳转，文末只有一条分隔线", async ({ page }) => {
  await createBlankDocument(page, "脚注跳转");
  await insertSample(page);
  const body = page.locator(".note-editor .editor-content");
  await expect(body.locator(".nr-footnotes").locator("xpath=preceding-sibling::*[1]")).toHaveJSProperty("tagName", "HR");
  await body.locator("#nr-footnote-ref-1").hover();
  await expect(page.getByRole("tooltip")).toContainText("这是一条脚注——点击箭头可返回原处。");
  await body.locator("h3").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await body.locator("#nr-footnote-ref-1").click();
  await expect(body.locator("#nr-footnote-1")).toBeInViewport();
  await body.getByRole("link", { name: "返回脚注引用" }).click();
  await expect(body.locator("#nr-footnote-ref-1")).toBeInViewport();
  await page.reload();
  await expect(body.locator("#nr-footnote-1")).toContainText("这是一条脚注");
  await expect(body.locator("#nr-footnote-ref-1")).toBeVisible();
});

test("虚拟只读长文中的脚注可跳至未挂载末尾并返回", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nr:experimentalReadonlyRendering", "true"));
  await createBlankDocument(page, "只读脚注跳转");
  await insertSample(page);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const body = page.locator(".note-editor[data-virtual-reader=true] .vr-body");
  await expect(body).toBeVisible();
  await expect(body.locator("#nr-footnote-1")).toHaveCount(0);
  await body.locator("#nr-footnote-ref-1").click();
  await expect(body.locator("#nr-footnote-1")).toBeInViewport();
  await body.getByRole("link", { name: "返回脚注引用" }).click();
  await expect(body.locator("#nr-footnote-ref-1")).toBeInViewport();
});

for (const width of [1280, 390]) test(`脚注编辑保存认证、重复返回及只读刷新 ${width}`, async ({ page }) => {
  await createBlankDocument(page, "脚注备份认证");
  const editor = page.locator(".note-editor:visible .tiptap.ProseMirror").first();
  await editor.evaluate(async element => {
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-footnotes-v1.json");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    const { createReferenceAnchor } = await import("/src/extensions/ReferenceAnchors.ts");
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    const doc = deltaToProseMirror(fixture.notes[0].content);
    doc.content.splice(-2, 0, ...Array.from({ length: 60 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `正文段落 ${i}` }] })));
    instance.commands.setContent(doc, true);
    createReferenceAnchor(instance, "block", 0);
  });
  await page.getByRole("navigation", { name: "工作区面板" }).getByRole("button", { name: "文档树", exact: true }).click();
  await page.setViewportSize({ width, height: 800 });
  const refs = editor.locator('sup[data-footnote-ref="中文"] a');
  const definition = editor.locator('li[data-footnote-id="中文"]');
  await expect(refs).toHaveCount(2);
  await refs.first().click();
  await expect(definition).toBeInViewport();
  await definition.locator("p").first().click();
  await page.keyboard.insertText("编辑脚注");
  const saved = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { reviewCandidatePayload } = await import("/src/lib/sync/candidate-write-policy.ts");
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-footnotes-v1.json");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    if (!note || !JSON.stringify(note.content).includes("编辑脚注")) return false;
    const review = reviewCandidatePayload(JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content: note.content }] }), "web");
    return review.eligible && review.requiredFeatures.includes("footnotes-v1") && note.content.metadata?.referenceAnchors?.length === 1;
  });
  await expect.poll(saved).toBe(true);
  await expect(definition.locator(".nr-footnote-backref")).toHaveCount(2);
  await definition.getByRole("link", { name: "返回脚注引用 2", exact: true }).click();
  await expect(refs.nth(1)).toBeInViewport();
  await page.reload();
  await expect(editor.locator(":scope > hr")).toHaveCount(1);
  await expect(definition).toContainText("编辑脚注");
  await expect.poll(saved).toBe(true);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await refs.nth(1).click();
  await expect(definition).toBeInViewport();
  await definition.getByRole("link", { name: "返回脚注引用 2", exact: true }).click();
  await expect(refs.nth(1)).toBeInViewport();
});
