import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const width of [1280, 390]) test(`图片缩放自动保存、刷新并通过备份候选认证 ${width}`, async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor:visible .tiptap.ProseMirror").first();
  await editor.evaluate(async element => {
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-image-v1.json");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setContent(deltaToProseMirror(fixture.notes[0].content), true);
  });
  // Complete desktop setup before checking the narrow rendering, since the
  // document sidebar becomes a modal drawer when crossing the mobile boundary.
  await page.getByRole("navigation", { name: "工作区面板" }).getByRole("button", { name: "文档树", exact: true }).click();
  await page.setViewportSize({ width, height: 800 });
  const image = editor.locator(".resizable-image-wrapper img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  const handle = editor.locator(".resize-handle");
  await handle.dispatchEvent("pointerdown", { pointerId: 5, pointerType: "touch", button: 0, clientX: 240, clientY: 200 });
  await handle.dispatchEvent("pointermove", { pointerId: 5, pointerType: "touch", clientX: 200, clientY: 200 });
  await handle.dispatchEvent("pointerup", { pointerId: 5, pointerType: "touch", clientX: 200, clientY: 200 });
  await expect(image).toHaveCSS("width", "200px");
  const stored = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { reviewCandidatePayload } = await import("/src/lib/sync/candidate-write-policy.ts");
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-image-v1.json");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    if (!note) return null;
    const body = note.content;
    const review = reviewCandidatePayload(JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content: body }] }), "web");
    return { eligible: review.eligible, features: review.requiredFeatures, attrs: body.ops[0]?.attributes };
  });
  await expect.poll(stored).toMatchObject({ eligible: true, features: expect.arrayContaining(["block-image-v1"]), attrs: { imageWidth: "200px", imageAlt: "图片替代文本 中文", imageTitle: '标题 "quoted"' } });
  await page.reload();
  await expect(image).toHaveCSS("width", "200px");
  await expect(image).toHaveAttribute("alt", "图片替代文本 中文");
  await expect.poll(stored).toMatchObject({ eligible: true, attrs: { imageWidth: "200px" } });
});

for (const width of [1280, 390]) test(`表格内行内图片保留位置链接、合并及锚点 ${width}`, async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor:visible .tiptap.ProseMirror").first();
  await editor.evaluate(async element => {
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-inline-image-v1.json");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    const { createReferenceAnchor } = await import("/src/extensions/ReferenceAnchors.ts");
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setContent(deltaToProseMirror(fixture.notes[1].content), true);
    createReferenceAnchor(instance, "block", 0);
  });
  await page.getByRole("navigation", { name: "工作区面板" }).getByRole("button", { name: "文档树", exact: true }).click();
  await page.setViewportSize({ width, height: 800 });
  const image = editor.locator("th .markdown-inline-image img").first();
  await expect(image).toBeVisible();
  const handle = editor.locator("th .resize-handle").first();
  await handle.dispatchEvent("pointerdown", { pointerId: 6, pointerType: "touch", button: 0, clientX: 80, clientY: 200 });
  await handle.dispatchEvent("pointermove", { pointerId: 6, pointerType: "touch", clientX: 60, clientY: 200 });
  await handle.dispatchEvent("pointerup", { pointerId: 6, pointerType: "touch", clientX: 60, clientY: 200 });
  await expect(image).toHaveCSS("width", "60px");
  await expect(editor.locator('td[colspan="2"] p')).toHaveCount(2);
  const saved = () => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { reviewCandidatePayload } = await import("/src/lib/sync/candidate-write-policy.ts");
    const { default: fixture } = await import("/schema/sync/fixtures/candidate-inline-image-v1.json");
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    if (!note || !JSON.stringify(note.content).includes('"width":"60px"')) return false;
    const review = reviewCandidatePayload(JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[1], content: note.content }] }), "web");
    return review.eligible && review.requiredFeatures.includes("inline-image-v1") && note.content.metadata?.referenceAnchors?.length === 1;
  });
  await expect.poll(saved).toBe(true);
  await page.reload();
  await expect(image).toHaveCSS("width", "60px");
  await expect(editor.locator('td[colspan="2"] p')).toHaveCount(2);
  await expect(image.locator("xpath=ancestor::a")).toHaveAttribute("href", "https://example.com/article#figure");
  await expect.poll(saved).toBe(true);
});
