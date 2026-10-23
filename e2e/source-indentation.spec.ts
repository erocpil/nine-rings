import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import {
  replaceSource,
  selectDocumentLanguage,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";

for (const language of ["c", "python", "javascript", "rust", "json", ""]) {
  test(`${language || "text"} 换行继承手动缩进，保留 Tab 与空格`, async ({
    page,
  }) => {
    await createBlankDocument(page, "源码缩进");
    await selectDocumentLanguage(page, language);
    const area = page.locator(".cm-content");
    for (const prefix of ["    ", "\t", "\t  "]) {
      const raw = prefix + "value";
      await replaceSource(area, raw);
      await selectSource(area, raw.length);
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await sourceInfo(area)).value)
        .toBe(raw + "\n" + prefix);
      await page.keyboard.type("next");
      await expect
        .poll(async () => (await sourceInfo(area)).value)
        .toBe(raw + "\n" + prefix + "next");
    }
  });
}

test("C 与 Python 保留语言缩进，Markdown 继续列表", async ({ page }) => {
  await createBlankDocument(page, "语言缩进");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  await replaceSource(area, "int main() {}");
  await selectSource(area, 12);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("int main() {\n\t\n}");
  await selectDocumentLanguage(page, "python");
  await replaceSource(area, "if True:");
  await selectSource(area, 8);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("if True:\n\t");
  await selectDocumentLanguage(page, "markdown");
  await replaceSource(area, "- item");
  await selectSource(area, 6);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("- item\n- ");
});

test("C 源码在新行输入右花括号时自动回退一级缩进", async ({ page }) => {
  await createBlankDocument(page, "右花括号自动退格");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  await replaceSource(area, "if (!s) {");
  await selectSource(area, "if (!s) {".length);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("if (!s) {\n\t");
  await page.keyboard.type("}");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("if (!s) {\n}");
});

test("源码在新行输入右圆括号和右方括号时按语法缩进对齐", async ({ page }) => {
  await createBlankDocument(page, "右括号自动对齐");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");

  const call = "call(";
  await replaceSource(area, call);
  await selectSource(area, call.length);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("call(\n\t");
  await page.keyboard.type(")");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("call(\n)");

  const subscript = "if (x) {\n\tint x = array[\n\t\tindex\n\t\t";
  await replaceSource(area, subscript);
  await selectSource(area, subscript.length);
  await page.keyboard.type("]");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("if (x) {\n\tint x = array[\n\t\tindex\n\t]");
});

test("源码状态栏配置缩进、转换并撤销，重开保留配置，只读禁止转换", async ({
  page,
}) => {
  await createBlankDocument(page, "缩进选项");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const size = page.getByRole("button", { name: "Tab Size", exact: true });
  const style = page.getByRole("button", { name: "缩进方式", exact: true });
  await expect(size).toContainText("Tab 4");
  await expect(style).toContainText("Tab");
  const format = page
    .locator(".editor-status-bar")
    .getByRole("button", { name: "文件格式", exact: true });
  const [sizeBox, styleBox, formatBox] = await Promise.all([
    size.boundingBox(),
    style.boundingBox(),
    format.boundingBox(),
  ]);
  expect(sizeBox).not.toBeNull();
  expect(styleBox).not.toBeNull();
  expect(formatBox).not.toBeNull();
  expect(sizeBox!.x).toBeLessThan(styleBox!.x);
  expect(styleBox!.x).toBeLessThan(formatBox!.x);
  const choose = async (
    button: import("@playwright/test").Locator,
    label: string,
  ) => {
    await button.click();
    await page
      .getByRole("menuitemcheckbox", { name: label, exact: true })
      .click();
  };
  const raw = '    int n;\n\tprintf("a  b");';
  await replaceSource(area, raw);
  await choose(style, "Spaces");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe('    int n;\n    printf("a  b");');
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await choose(style, "Tab");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe('\tint n;\n\tprintf("a  b");');
  await choose(size, "Tab 2");
  await replaceSource(area, "int main() {}");
  await selectSource(area, 12);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("int main() {\n\t\n}");
  await choose(style, "Spaces");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("int main() {\n  \n}");
  await choose(size, "Tab 8");
  await replaceSource(area, "value");
  await selectSource(area, 0);
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("        value");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { api } = await import("/src/lib/api.ts");
        return (await api.notes.get(localStorage.getItem("nr:lastNote")!))
          ?.content.metadata?.sourceText;
      }),
    )
    .toBe("        value");
  await page.reload();
  await expect(size).toContainText("Tab 8");
  await expect(style).toContainText("Spaces");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect(size).toBeDisabled();
  await expect(style).toBeDisabled();
});

test("源码自动缩进支持选区和全文，并可作为单次撤销", async ({ page }) => {
  await createBlankDocument(page, "自动缩进");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const raw = "int main() {\nint value = 1;\nif (value) {\nvalue++;\n}\n}";
  await replaceSource(area, raw);
  const selectionCommand = page.getByRole("button", {
    name: "自动缩进选区",
    exact: true,
  });
  await expect(page.locator(".markdown-source-cursor")).toHaveCount(0);
  await expect(page.locator(".markdown-source-status")).toContainText(
    "Ln 1/6, Col",
  );
  await expect(selectionCommand).toBeDisabled();
  const sourceViewportBefore = await page
    .locator(".markdown-cm-host")
    .boundingBox();
  await page.getByRole("button", { name: "自动缩进全文", exact: true }).click();
  const toast = page.getByRole("status").filter({ hasText: "已缩进全文" });
  await expect(toast).toBeVisible();
  expect((await page.locator(".markdown-cm-host").boundingBox())!.height).toBe(
    sourceViewportBefore!.height,
  );
  await toast.getByRole("button", { name: "关闭提示" }).click();
  await expect(toast).toHaveCount(0);
  expect(
    await page
      .locator(".cm-content")
      .evaluate((element) => element === document.activeElement),
  ).toBe(true);
  const formatted =
    "int main() {\n\tint value = 1;\n\tif (value) {\n\t\tvalue++;\n\t}\n}";
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(formatted);
  await page.getByRole("button", { name: "自动缩进全文", exact: true }).click();
  const noChange = page
    .getByRole("status")
    .filter({ hasText: "当前范围无需调整" });
  await expect(noChange).toBeVisible();
  await noChange.getByRole("button", { name: "关闭提示" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);

  await selectSource(area, raw.indexOf("int value"), raw.indexOf("\n}\n}") + 2);
  await expect(selectionCommand).toBeEnabled();
  await selectionCommand.click();
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe(
      "int main() {\n\tint value = 1;\n\tif (value) {\n\t\tvalue++;\n\t}\n}",
    );
});

test("C 自动缩进保留函数参数续行并恢复后续语句缩进", async ({ page }) => {
  await createBlankDocument(page, "函数参数续行");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const lines = [
    "void split() {",
    "n = block_init((struct Block *)((uintptr_t)b + BLOCK_SIZE + size),",
    "b->size - size - BLOCK_SIZE, b, b->next);",
    "run();",
    "}",
  ];
  const raw = lines.join("\n");
  await replaceSource(area, raw);
  await page.getByRole("button", { name: "自动缩进全文", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(
    lines.map((line, index) => "\t".repeat([0, 1, 3, 1, 0][index]) + line).join("\n"),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
});

test("C++ 自动缩进在成员定义后保留类作用域", async ({ page }) => {
  await createBlankDocument(page, "C++ 类缩进");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const raw = [
    "class LRUCache {",
    "\tpublic:",
    "\t\tLRUCache(size_t capacity) : size(capacity), num(0) {",
    "\t\t\thead = new Entry();",
    "\t\t};",
    "\t\t~LRUCache() {",
    "\t\t\t// TODO delete all Entries",
    "\t\t\tdelete head;",
    "\t\t};",
    "\t\tint get(int key) {",
    "\t\t\tauto it = cache.find(key);",
    "\t\t\tif (it == cache.end()) return -1;",
    "\t\t\tEntry *e = it->second;",
    "\t\t\tdel(e);",
    "\t\t\tadd(e);",
    "\t\t\treturn e->val;",
    "\t\t}",
    "};",
  ].join("\n");
  await replaceSource(area, raw);
  await page.getByRole("button", { name: "自动缩进全文", exact: true }).click();
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe(
      [
        "class LRUCache {",
        "public:",
        "\tLRUCache(size_t capacity) : size(capacity), num(0) {",
        "\t\thead = new Entry();",
        "\t};",
        "\t~LRUCache() {",
        "\t\t// TODO delete all Entries",
        "\t\tdelete head;",
        "\t};",
        "\tint get(int key) {",
        "\t\tauto it = cache.find(key);",
        "\t\tif (it == cache.end()) return -1;",
        "\t\tEntry *e = it->second;",
        "\t\tdel(e);",
        "\t\tadd(e);",
        "\t\treturn e->val;",
        "\t}",
        "};",
      ].join("\n"),
    );
});
