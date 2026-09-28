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
