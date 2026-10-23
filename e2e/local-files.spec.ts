import { test, expect } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";

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
  await panel.getByRole("button", { name: "选择只读目录" }).click();
  const folder = panel.getByRole("button", { name: "src", exact: true });
  await expect(folder).toBeVisible();
  expect(await page.evaluate(() => (window as any).__fileCalls)).toEqual([
    "list:local-project",
  ]);
  await folder.click();
  await panel.getByRole("button", { name: "sample.c", exact: true }).click();
  const viewer = page.getByRole("region", { name: "只读本地源码" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    viewer.getByRole("button", { name: "源码符号", exact: true }),
  ).toBeEnabled();
  await viewer.getByRole("button", { name: "源码符号", exact: true }).click();
  await viewer
    .getByRole("complementary", { name: "本地源码符号" })
    .getByRole("button", { name: "local_function", exact: false })
    .click();
  await expect(viewer.locator("footer")).toContainText("Ln 62");
  await expect
    .poll(() =>
      viewer.locator(".cm-scroller").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await viewer.getByRole("button", { name: "当前文件查找" }).click();
  await expect(viewer.locator(".cm-search")).toBeVisible();
  await viewer.locator(".cm-search input[name=search]").fill("value");
  await viewer.locator(".cm-search input[name=search]").press("Enter");
  await expect(viewer.locator(".cm-searchMatch").first()).toBeVisible();
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
  const viewer = page.getByRole("region", { name: "只读本地源码" });
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
