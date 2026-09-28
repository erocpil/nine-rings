import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

async function savedDetails(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const id = localStorage.getItem("nr:lastNote");
    const note = id ? await api.notes.get(id) : null;
    const embed = note?.content?.ops.find((op: { insert?: unknown }) => typeof op.insert === "object" && op.insert && "htmlDetails" in op.insert)?.insert as { htmlDetails?: { summary?: string; content?: Array<{ insert?: unknown }> } } | undefined;
    return { summary: embed?.htmlDetails?.summary, body: embed?.htmlDetails?.content?.map(op => typeof op.insert === "string" ? op.insert : "").join("").trimEnd() };
  });
}

test("独立行 details 在正文可展开并收起", async ({ page }) => {
  await createBlankDocument(page, "折叠内容");
  await page.locator(".note-editor .ProseMirror").evaluate(async element => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent(deltaToProseMirror(mdToDelta("<details>\n<summary>点击展开</summary>\n\n这里是被折叠的内容。\n</details>")), true);
  });
  await expect.poll(() => savedDetails(page)).toEqual({ summary: "点击展开", body: "这里是被折叠的内容。" });
  const details = page.locator(".note-editor .ProseMirror > .nr-details-node > details");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("这里是被折叠的内容。");
  await details.locator("summary").click();
  await expect(details).not.toHaveAttribute("open");
  await details.getByRole("button", { name: "块模式" }).click();
  const workspace = page.getByRole("dialog", { name: "折叠区块工作区" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByLabel("折叠区块标题")).toHaveValue("点击展开");
  await expect(workspace.locator(".nr-details-content")).toContainText("这里是被折叠的内容。");
  await workspace.getByRole("button", { name: "切换到编辑模式" }).click();
  await workspace.getByLabel("折叠区块标题").fill("新的标题");
  await expect(details.locator("summary")).toContainText("新的标题");
  await workspace.locator(".nr-details-content p").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("新增正文");
  await expect(details.locator(".nr-details-content")).toContainText("新增正文");
  await workspace.getByRole("button", { name: "关闭块工作区" }).click();
  await expect(details).not.toHaveAttribute("open");
  await expect.poll(() => savedDetails(page)).toEqual({ summary: "新的标题", body: "这里是被折叠的内容。新增正文" });
  await page.reload();
  await expect(details.locator("summary")).toContainText("新的标题");
  await expect(details.locator(".nr-details-content")).toContainText("新增正文");
  await expect(details).not.toHaveAttribute("open");
});

for (const virtual of [false, true]) {
test(`只读${virtual ? "虚拟" : "普通"}视图保留折叠区块的展开与收起`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("nr:experimentalReadonlyRendering", String(value)), virtual);
  await createBlankDocument(page, "只读折叠内容");
  await page.locator(".note-editor .ProseMirror").evaluate(async element => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent(deltaToProseMirror(mdToDelta("<details>\n<summary>点击展开</summary>\n\n这里是被折叠的内容。\n</details>")), true);
  });
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const details = page.locator(virtual ? ".note-editor[data-virtual-reader=true] .nr-details" : ".note-editor .nr-details-node > details");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).not.toHaveAttribute("open");
  await details.getByRole("button", { name: "块模式" }).click();
  await expect(page.getByRole("dialog", { name: "折叠区块工作区" })).toBeVisible();
});
}
