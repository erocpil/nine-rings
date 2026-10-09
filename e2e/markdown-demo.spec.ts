import { expect, test } from "@playwright/test";
import { sourceInfo } from "./helpers/source-editor";
import { scrollEditorBlockTo } from "./helpers/editor-scroll";

for (const width of [390, 1280]) test(`内置 Markdown 全景演示 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  await page.evaluate(async () => {
    const apiPath = "/src/lib/api.ts";
    const storePath = "/src/stores/useNotesStore.ts";
    const { api } = await import(/* @vite-ignore */ apiPath);
    const { useNotesStore } = await import(/* @vite-ignore */ storePath);
    const note = await api.notes.get(localStorage.getItem("nr:builtin-markdown-demo:v1")!);
    if (note.storagePath !== "ideas") throw new Error("demo path");
    await useNotesStore.getState().selectNote(note);
  });
  const root = page.locator(".note-editor:visible .editor-content").first();
  await expect(root.locator("table").first()).toBeAttached();
  await expect(root.locator(".nr-footnote-reference")).toHaveCount(3);
  await expect(root.locator(".nr-footnote-backref")).toHaveCount(3);
  await expect(root.locator("details")).toHaveCount(2);
  await root.locator(".flow-block-wrap").evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect(root.locator(".flow-step")).toHaveCount(3);
  await expect(root.locator(".flow-step .flow-prose > h3")).toHaveCount(3);
  await expect(root.locator('img[alt="小图标"]')).toHaveAttribute("src", /ragdoll-32/);
  await expect(root.locator("#demo-anchor")).toBeAttached();
  await expect(root).not.toContainText("demo-comment:");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toBeVisible();
  // The source remains byte-preserved until a rendered edit.
  const { value } = await sourceInfo(source);
  expect(value).toContain("```toc");
  expect(value.indexOf("[^first-note]:")).toBeLessThan(value.indexOf("## 八、"));
});

test("已有 Markdown 全景只升级原始 H2 流程，重启后渲染与源码都是 H3", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  const id = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const id = localStorage.getItem("nr:builtin-markdown-demo:v1")!;
    const note = await api.notes.get(id);
    const source = note.content.metadata.markdownSource.replace(/^### (捕捉|行动|复核)$/gm, "## $1");
    const updated = await api.notes.update(id, { readonly: true, content: { ...mdToDelta(source), metadata: { ...note.content.metadata, markdownSource: source } } });
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    await useNotesStore.getState().selectNote(updated);
    localStorage.removeItem("nr:builtin-markdown-demo:flow-h3:v1");
    localStorage.setItem("nr:lastNote", id);
    return id;
  });
  await expect(page.locator(".note-editor:visible .flow-block-wrap")).toBeAttached();
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:flow-h3:v1"))).toBe(id);
  await expect.poll(() => page.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(id)).content.metadata.markdownSource;
  }, id)).toContain("````flow\n### 捕捉");
  const root = page.locator(".note-editor:visible .editor-content").first();
  await scrollEditorBlockTo(page, root.locator(".flow-block-wrap"), 80);
  await expect(root.locator(".flow-step .flow-prose > h3")).toHaveCount(3);
  await expect(root.locator(".flow-step .flow-prose > h2")).toHaveCount(0);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  expect((await sourceInfo(area)).value).toContain("````flow\n### 捕捉");
});
