import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openWritableLocalDirectory } from "./helpers/local-files";
import { sourceInfo } from "./helpers/source-editor";

const original = "#   原始标题\n\n正文 *斜体* 与 [链接](other.md)\n\n![本地图片](pic.svg)\n";
test("磁盘 Markdown 共用渲染编辑器，原文往返、撤销、立即保存、相对资源与只读门禁", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "note.md": original, "pic.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>' }, "note.md");
  const disk = () => page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("note.md").read() as string);
  const writes = () => page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("note.md").writes as number);
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const editor = workspace.locator(".ProseMirror:visible");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor.locator("img")).toHaveJSProperty("naturalWidth", 20);
  expect(await disk()).toBe(original); expect(await writes()).toBe(0);
  await workspace.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(workspace.locator(".cm-content"))).value).toBe(original);
  await workspace.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(workspace.locator(".markdown-preview-pane")).toBeVisible();
  await workspace.getByRole("button", { name: "并排预览", exact: true }).click();
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const paragraph = editor.locator("p").filter({ hasText: "正文" }).first();
  await paragraph.click();
  await page.keyboard.press("End"); await page.keyboard.insertText(" 可撤销");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await workspace.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(workspace.locator(".cm-content"))).value).toBe(original);
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await paragraph.click(); await page.keyboard.press("End"); await page.keyboard.insertText(" 已编辑");
  await workspace.getByRole("button", { name: "保存文件", exact: true }).click();
  await expect.poll(disk).toContain("已编辑");
  expect(await disk()).toContain("(pic.svg)"); expect(await disk()).not.toContain("data:image");
  expect(await writes()).toBe(1);
  await workspace.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  const saved = await disk();
  await editor.evaluate(element => (element as any).editor.commands.insertContent("禁止写入"));
  await expect(editor).not.toContainText("禁止写入");
  expect(await disk()).toBe(saved); expect(await writes()).toBe(1);
  await expect(workspace.getByRole("button", { name: "复制块引用", exact: true })).toHaveCount(0);
});

test("源码与渲染共用标题重命名、信息卡和未保存保护", async ({ page }) => {
  await createBlankDocument(page);
  const { tree, workspace } = await openWritableLocalDirectory(page, { "start.md": "# 标题\n\n正文\n" }, "start.md");
  const title = workspace.getByRole("textbox", { name: "文档标题", exact: true });
  await title.fill("cancel-source.md");
  await title.press("Escape");
  await page.waitForTimeout(250); // Observe an unintended asynchronous blur rename.
  await expect(title).toHaveValue("start.md");
  await expect(
    tree.getByRole("button", { name: "start.md", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "cancel-source.md", exact: true }),
  ).toHaveCount(0);
  await title.fill("source.md"); await title.press("Enter");
  await expect(title).toHaveValue("source.md");
  await expect(tree.getByRole("button", { name: "source.md", exact: true })).toBeVisible();
  await title.hover({ position: { x: 20, y: 12 } });
  const info = workspace.getByRole("tooltip", { name: "source.md 的文档信息", exact: true });
  await expect(info).toContainText("Markdown"); await expect(info).toContainText("source.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await title.fill("cancel-rendered.md");
  await title.press("Escape");
  await page.waitForTimeout(250);
  await expect(title).toHaveValue("source.md");
  await expect(
    tree.getByRole("button", { name: "source.md", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "cancel-rendered.md", exact: true }),
  ).toHaveCount(0);
  await title.fill("rendered.md"); await title.press("Enter");
  await expect(title).toHaveValue("rendered.md");
  await expect(workspace.locator(".ProseMirror:visible")).toContainText("正文");
  await expect(tree.getByRole("button", { name: "rendered.md", exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "显示源码", exact: true }).click();
  await workspace.locator(".cm-content").fill("# 未保存的正文\n");
  await title.fill("blocked.md"); await title.press("Enter");
  await expect(workspace.getByRole("alert")).toContainText("未保存");
  await expect(tree.getByRole("button", { name: "rendered.md", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "blocked.md", exact: true })).toHaveCount(0);
  await title.press("Escape");
  await expect(title).toHaveValue("rendered.md");
  await expect.poll(async () => (await sourceInfo(workspace.locator(".cm-content"))).value).toBe("# 未保存的正文\n");
});


test("渲染编辑在写入期间继续输入和外部冲突时不丢失，重载采用磁盘新版本", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "note.md": "# 标题\n\n正文\n" }, "note.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const editor = workspace.locator(".ProseMirror:visible");
  const append = async (text: string) => {
    await editor.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(text);
  };
  const disk = () => page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("note.md").read() as string);
  await page.evaluate(() => {
    const node = (window as any).__localWorkspaceFixture.nodes.get("note.md");
    node.beforeClose = () => new Promise<void>(resolve => { node.finishWrite = () => { node.beforeClose = null; resolve(); }; });
  });
  await append(" 第一笔");
  await workspace.getByRole("button", { name: "保存文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__localWorkspaceFixture.nodes.get("note.md").finishWrite))).toBe(true);
  await append(" 第二笔");
  await page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("note.md").finishWrite());
  await expect.poll(disk).toContain("第一笔");
  expect(await disk()).not.toContain("第二笔");
  await expect(workspace.getByRole("button", { name: "保存文件", exact: true })).toBeEnabled();
  await workspace.getByRole("button", { name: "保存文件", exact: true }).click();
  await expect.poll(disk).toContain("第二笔");
  await append(" 未保存");
  await page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("note.md").setText("# 外部标题\n\n外部正文\n"));
  await workspace.getByRole("button", { name: "保存文件", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "重载磁盘版本", exact: true })).toBeVisible();
  await expect(editor).toContainText("未保存");
  expect(await disk()).toContain("外部正文");
  await editor.evaluate(element => {
    (element as any).editor.commands.insertContent("重载前的待转换编辑");
    element.closest(".local-file-view")!.querySelector<HTMLButtonElement>(".local-file-conflict button")!.click();
  });
  await expect(editor).toContainText("外部正文");
  await expect(editor).not.toContainText("未保存");
});


test("渲染后立即下载副本包含待转换正文，只读标题仍有信息卡并交接当前块", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "note.md": "# 标题\n\n第一段\n\n第二段\n" }, "note.md");
  await page.evaluate(() => Object.defineProperty(window, "showSaveFilePicker", {value: undefined, configurable: true}));
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const editor = workspace.locator(".ProseMirror:visible");
  const download = page.waitForEvent("download");
  await editor.evaluate(element => {
    (element as any).editor.commands.insertContent("立即复制");
    element.closest(".local-file-view")!.querySelector<HTMLButtonElement>('button[aria-label="另存为副本"]')!.click();
  });
  const file = await download;
  expect(await readFile((await file.path())!, "utf8")).toContain("立即复制");
  await workspace.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await workspace.locator(".note-title").hover({position: {x: 12, y: 12}});
  await expect(workspace.getByRole("tooltip", {name: "note.md 的文档信息", exact:true})).toBeVisible();
  await page.mouse.move(1200, 700);
  await expect(workspace.getByRole("tooltip", {name: "note.md 的文档信息", exact:true})).toHaveCount(0);
  await editor.locator("p").filter({hasText: "第二段"}).click({position:{x:10,y:10}});
  await workspace.getByRole("button", {name: "显示源码",exact:true}).click();
  await expect.poll(async () => {
    const info = await sourceInfo(workspace.locator(".cm-content"));
    return info.value.slice(0, info.selectionStart).split("\n").length;
  }).toBe(5);
});
