import { readFile } from "node:fs/promises";
import { test, expect, type Locator } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { openWritableLocalDirectory } from "../helpers/local-files";
import { replaceSource, selectSource, sourceInfo } from "../helpers/source-editor";

test("磁盘书签多处源码修改后跳转到原内容并保存新位置", async ({ page }) => {
  const before = "first\n\nbefore\n\ntarget bookmark\n\nafter\n\nlast\n";
  const after = "new first\n\ninserted\n\nbefore\n\ntarget bookmark\n\nafter\n\nnew last\n";
  await createBlankDocument(page);
  const { tree, workspace: viewer } = await openWritableLocalDirectory(page, { "anchors.md": before }, "anchors.md");
  const area = viewer.locator(".cm-content");
  await selectSource(area, before.indexOf("target bookmark"));
  await viewer.getByRole("button", { name: "书签", exact: true }).click();
  await viewer.getByRole("button", { name: "添加或移除当前行书签", exact: true }).click();
  const bookmark = viewer.locator(".document-bookmark-jump").filter({ hasText: "target bookmark" });
  await expect(bookmark).toBeVisible();
  const checkJump = async (source: string) => {
    await bookmark.click();
    await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.indexOf("target bookmark"));
  };
  await replaceSource(area, after);
  await checkJump(after);
  await area.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(before);
  await checkJump(before);
  await area.focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(after);
  await viewer.getByRole("button", { name: "渲染", exact: true }).click();
  const body = viewer.getByLabel("Markdown 渲染", { exact: true }).locator(".ProseMirror");
  await expect(body.getByText("target bookmark", { exact: true })).toBeVisible();
  await body.evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "rendered insertion" }] });
  });
  await viewer.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect(area).toContainText("rendered insertion");
  const renderedSource = (await sourceInfo(area)).value;
  if (!(await bookmark.isVisible())) await viewer.getByRole("button", { name: "书签", exact: true }).click();
  await checkJump(renderedSource);
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("nr:local-file-bookmarks:") && key.endsWith(":anchors.md"));
    return key && JSON.parse(localStorage.getItem(key)!)[0]?.offset;
  })).toBe(renderedSource.indexOf("target bookmark"));

  await viewer.getByRole("button", { name: "保存文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("anchors.md").read())).toBe(renderedSource);
  await tree.getByRole("button", { name: "关闭文件 anchors.md", exact: true }).click();
  await expect(viewer).toBeHidden();
  // Simulate an existing record from before bookmarks had stable IDs.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("nr:local-file-bookmarks:") && key.endsWith(":anchors.md"))!;
    const [{ offset, line, label }] = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify([{ offset, line, label }]));
  });
  await tree.getByRole("button", { name: "anchors.md", exact: true }).click();
  await expect(area).toContainText("rendered insertion");
  if (!(await bookmark.isVisible())) await viewer.getByRole("button", { name: "书签", exact: true }).click();
  await checkJump(renderedSource);
});

const original = "#   原始标题\n\n正文 *斜体* 与 [链接](other.md)\n\n![本地图片](pic.svg)\n";

test("磁盘 Markdown 表格后补反引号并输入空格，只留下行内代码与普通空格", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "code.md": "| Header |\n| --- |\n| sample |\n| x |\n" }, "code.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const body = workspace.locator(".ProseMirror:visible");
  const cell = body.locator("td p").first();
  const placeCaret = (target: Locator, atEnd: boolean) => target.evaluate((element, end) => {
    const root = element.closest(".ProseMirror") as HTMLElement & { editor: import("@tiptap/core").Editor };
    const { view, commands } = root.editor;
    commands.setTextSelection(view.posAtDOM(element, end ? element.childNodes.length : 0));
    view.focus();
  }, atEnd);
  await placeCaret(cell, true);
  await page.keyboard.insertText("`");
  await placeCaret(cell, false);
  await page.keyboard.insertText("`");
  await expect(cell).toHaveText("`sample`");
  await placeCaret(cell, true);
  await page.keyboard.insertText(" ");
  await expect(cell.locator("code")).toHaveText("sample");
  await page.keyboard.insertText("next");
  await expect(cell).toHaveText("sample next");
  await expect(cell.locator("code")).toHaveText("sample");
  const nextCell = body.locator("td p").last();
  await placeCaret(nextCell, true);
  await page.keyboard.insertText("`x");
  await page.keyboard.insertText("`");
  await expect(nextCell).toHaveText("xx");
  await expect(nextCell.locator("code")).toHaveText("x");
  await workspace.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(workspace.locator(".cm-content"))).value).toContain("| `sample` next |");
});

for (const style of ["classic", "calm", "paper"]) test(`磁盘 Markdown 状态栏折叠按钮留在工作区右边界内 ${style}`, async ({ page }) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style })), style);
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "status.md": "# Heading\n\nFirst paragraph\n" }, "status.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const settings = workspace.getByRole("button", { name: "块号与折叠设置", exact: true });
  for (const width of [1280, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 900) {
      await workspace.getByRole("button", { name: "文档目录", exact: true }).click();
      await expect(workspace.locator(".note-editor.document-panels-pinned .document-panel-dock")).toBeVisible();
    }
    for (const readonly of [false, true]) {
      if (readonly) await workspace.getByRole("button", { name: "点击设为只读", exact: true }).click();
      await expect(settings).toBeVisible();
      const measure = () => settings.evaluate(element => {
        const bar = element.closest<HTMLElement>(".editor-status-bar")!;
        // The typography preset may center a narrower text column inside the chrome.
        const scroll = bar.closest(".note-editor")!.querySelector(".note-editor-scroll")!;
        const edge = Math.min(bar.getBoundingClientRect().right, scroll.getBoundingClientRect().right)
          - parseFloat(getComputedStyle(bar).paddingRight);
        return element.getBoundingClientRect().right - edge;
      });
      await expect.poll(measure, { message: `width=${width} readonly=${readonly}` }).toBeLessThanOrEqual(1);
      if (readonly) await workspace.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
    }
  }
});

test("磁盘 Markdown 无本机编辑时检测到外部变化会自动重载并提示", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "external.md": "# Original\n\nOriginal paragraph\n" }, "external.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const body = workspace.locator(".ProseMirror:visible");
  await expect(body).toContainText("Original paragraph");
  await page.evaluate(() => (window as any).__localWorkspaceFixture.nodes.get("external.md").setText("# External revision\n\nParagraph changed on disk\n"));
  await expect(body).toContainText("Paragraph changed on disk");
  await expect(workspace.locator(".local-files-message").filter({ hasText: "检测到磁盘文件变化，已重新载入并保留阅读位置。" })).toBeVisible();
});

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
