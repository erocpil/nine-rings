import { test, expect } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";
import { selectSource, sourceInfo } from "./helpers/source-editor";

test("只读文件夹入口按需展开、源码查找和符号跳转，不创建文档，停用返回原视图", async ({
  page,
}) => {
  await createBlankDocument(page, "本地文件入口回归");
  await page.locator(".ProseMirror:visible").fill("保留原有文档内容");
  await waitForSavedText(page, "保留原有文档内容");
  const baseline = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return {
      count: (await api.docs.summaries()).length,
      id: localStorage.getItem("nr:lastNote"),
    };
  });
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } =
      await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true);
    saveLocalFilesEnabled(true);
    const calls: string[] = [];
    (window as any).__fileCalls = calls;
    const source =
      "struct Item { int value; };\r\n" +
      "// padding\r\n".repeat(60) +
      "int local_function(int value) {\r\n  return value + 7;\r\n}\r\n";
    function file(name: string, text: string) {
      return {
        kind: "file",
        name,
        getFile: async () => {
          calls.push("read:" + name);
          return new File([text], name);
        },
      };
    }
    function directory(name: string, children: any[]) {
      return {
        kind: "directory",
        name,
        async *values() {
          calls.push("list:" + name);
          for (const child of children) yield child;
        },
        getDirectoryHandle: async (key: string) =>
          children.find(
            (child) => child.kind === "directory" && child.name === key,
          ),
        getFileHandle: async (key: string) =>
          children.find((child) => child.kind === "file" && child.name === key),
      };
    }
    const root = directory("local-project", [
      directory("src", [
        file("sample.c", source),
        file("empty.txt", ""),
        file("binary.bin", "\0"),
      ]),
    ]);
    (window as any).showDirectoryPicker = async (options: any) => {
      if (options.mode !== "read") throw new Error("unexpected write request");
      return root;
    };
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  await panel.getByRole("button", { name: "选择本地目录" }).click();
  const folder = panel.getByRole("button", { name: "src", exact: true });
  await expect(folder).toBeVisible();
  const initialCalls = await page.evaluate(() => (window as any).__fileCalls as string[]);
  expect(initialCalls.length).toBeGreaterThan(0);
  // Visible roots may refresh; unopened descendants and file bodies must stay unread.
  expect(initialCalls.every(call => call === "list:local-project")).toBe(true);
  await folder.click();
  // The workspace now defaults to editable. Make this fixture explicitly readonly.
  const sample = panel.locator(".local-file-row").filter({ has: page.locator(".local-file-name", { hasText: /^sample\.c$/ }) });
  await sample.click({ button: "right" });
  await page.getByRole("menuitem", { name: "设为只读", exact: true }).click();
  await sample.click();
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: "专注模式", exact: true })).toHaveCount(0);
  await expect(viewer.locator(".local-file-path")).toHaveCount(0);
  await expect(viewer.locator(".local-file-titlebar strong")).toHaveText("sample.c");
  await expect(viewer.locator(".cm-content")).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(viewer.locator(".cm-activeLine")).toHaveCount(1);
  await expect(viewer.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    viewer.getByRole("button", { name: "源码符号", exact: true }),
  ).toBeEnabled();
  await viewer.getByRole("button", { name: "行号与折叠设置" }).click();
  const lineNumbers = page.getByRole("menuitemcheckbox", { name: "显示行号", exact: true });
  if (await lineNumbers.getAttribute("aria-checked") !== "true") await lineNumbers.click();
  await page.keyboard.press("Escape");
  const area = viewer.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  const sourceBeforeGutterActions = (await sourceInfo(area)).value;
  const cursorOffset = sourceBeforeGutterActions.indexOf("return value") + 5;
  const functionStart = sourceBeforeGutterActions.indexOf("int local_function");
  const clickLineNumberAt = async () => {
    const point = await area.evaluate((element, offset) => {
      const view = (window as any).sourceCM.EditorView.findFromDOM(element)!;
      const text = view.coordsAtPos(offset)!;
      const gutter = view.dom.querySelector(".cm-lineNumbers")!.getBoundingClientRect();
      return { x: gutter.left + gutter.width / 2, y: (text.top + text.bottom) / 2 };
    }, functionStart);
    await page.mouse.click(point.x, point.y);
  };
  await selectSource(area, cursorOffset);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await clickLineNumberAt();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(cursorOffset);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const foldPoint = await area.evaluate((element, offset) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(element)!;
    const text = view.coordsAtPos(offset)!;
    const gutter = view.dom.querySelector(".cm-foldGutter")!.getBoundingClientRect();
    return { x: gutter.left + gutter.width / 2, y: (text.top + text.bottom) / 2 };
  }, functionStart);
  await page.mouse.click(foldPoint.x, foldPoint.y);
  await expect(area.locator(".cm-foldPlaceholder")).toHaveCount(1);
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(sourceBeforeGutterActions.indexOf("{", functionStart) + 1);
  await area.locator(".cm-foldPlaceholder").click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(cursorOffset);
  expect((await sourceInfo(area)).value).toBe(sourceBeforeGutterActions);
  await viewer.getByRole("button", { name: "源码符号", exact: true }).click();
  await viewer
    .getByRole("complementary", { name: "本地源码符号" })
    .getByRole("button", { name: "local_function", exact: false })
    .click();
  await expect(viewer.locator(".markdown-source-status")).toContainText("Ln 62");
  await expect(viewer.locator(".cm-activeLine")).toContainText("local_function");
  await expect(viewer.locator(".cm-lineNumbers .cm-activeLineGutter")).toHaveText("62");
  const symbols = viewer.getByRole("complementary", { name: "本地源码符号" });
  await symbols.getByRole("button", { name: "收起源码符号", exact: true }).click();
  await expect(symbols).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "源码符号", exact: true })).toHaveAttribute("aria-pressed", "false");
  await viewer.getByRole("button", { name: "源码符号", exact: true }).click();
  await expect(symbols).toBeVisible();
  await viewer.getByRole("button", { name: "书签", exact: true }).click();
  const bookmarks = viewer.getByRole("complementary", { name: "本地文件书签" });
  await bookmarks.getByRole("button", { name: "收起书签", exact: true }).click();
  await expect(bookmarks).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "书签", exact: true })).toHaveAttribute("aria-pressed", "false");
  await viewer.getByRole("button", { name: "书签", exact: true }).click();
  await expect(bookmarks).toBeVisible();
  for (const cursor of await viewer.locator(".cm-cursor, .cm-cursorLayer").all()) await expect(cursor).not.toBeVisible();
  await viewer.locator(".cm-activeLine").click();
  await expect(viewer.locator(".cm-content")).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect
    .poll(() =>
      viewer.locator(".cm-scroller").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await viewer.getByRole("button", { name: "查找", exact: true }).click();
  await expect(viewer.locator(".cm-search")).toBeVisible();
  await viewer.locator(".cm-search input[name=search]").fill("value");
  await viewer.locator(".cm-search input[name=search]").press("Enter");
  await expect(viewer.locator(".cm-searchMatch").first()).toBeVisible();
  await viewer.getByRole("button", { name: "跳转行", exact: true }).click();
  await expect(viewer.locator(".cm-search")).toHaveCount(0);
  await expect(viewer.locator(".cm-goto-line")).toBeVisible();
  await viewer.getByRole("button", { name: "查找", exact: true }).click();
  await expect(viewer.locator(".cm-goto-line")).toHaveCount(0);
  await expect(viewer.locator(".cm-search input[name=search]")).toHaveValue("value");
  await page.keyboard.press("Escape");
  await expect(viewer.locator(".source-tool-panel")).toHaveCount(0);
  const now = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return {
      count: (await api.docs.summaries()).length,
      id: localStorage.getItem("nr:lastNote"),
    };
  });
  expect(now).toEqual(baseline);
  await viewer.getByRole("button", { name: "返回原视图" }).click();
  await expect(page.locator(".ProseMirror:visible")).toHaveText(
    "保留原有文档内容",
  );
  await panel.getByRole("button", { name: "empty.txt", exact: true }).click();
  await expect(viewer.locator(".cm-editor")).toBeVisible();
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  await panel.getByRole("button", { name: "binary.bin", exact: true }).click();
  await expect(viewer.getByRole("alert")).toContainText("二进制");
  await page.evaluate(async () => {
    const { saveLocalFilesEnabled } =
      await import("/src/lib/plugin-system/builtin-local-files.ts");
    saveLocalFilesEnabled(false);
  });
  await expect(viewer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "本地文件", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".ProseMirror:visible")).toHaveText(
    "保留原有文档内容",
  );
});

test("手机通过目录快照打开源码后收起抽屉，撤销目录授权恢复原文档", async ({
  page,
}, testInfo) => {
  await createBlankDocument(page, "手机原文档");
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } =
      await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true);
    saveLocalFilesEnabled(true);
    Object.defineProperty(window, "showDirectoryPicker", {
      value: undefined,
      configurable: true,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocumentSidebar(page);
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树" });
  const directory = testInfo.outputPath("snapshot");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "note.md"),
    "# 原始 Markdown\n\n**不转成富文本**\n",
  );
  await panel.locator("input[type=file]").setInputFiles(directory);
  await panel.getByRole("button", { name: "note.md", exact: true }).click();
  const viewer = page.getByRole("region", { name: "本地文件工作区" });
  await expect(viewer.locator(".cm-content")).toContainText("**不转成富文本**");
  await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  await openDocumentSidebar(page);
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "note.md", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "移除目录 snapshot", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "note.md", exact: true }),
  ).toHaveCount(0);
});
