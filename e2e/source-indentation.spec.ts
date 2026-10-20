import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo } from "./helpers/source-editor";

for (const language of ["c", "python", "javascript", "rust", "json", ""]) {
  test(`${language || "text"} 换行继承手动缩进，保留 Tab 与空格`, async ({ page }) => {
    await createBlankDocument(page, "源码缩进");
    await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption(language);
    const area = page.locator(".cm-content");
    for (const prefix of ["    ", "\t", "\t  "]) {
      const raw = prefix + "value";
      await replaceSource(area, raw);
      await selectSource(area, raw.length);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw + "\n" + prefix);
      await page.keyboard.type("next");
      await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw + "\n" + prefix + "next");
    }
  });
}

test("C 与 Python 保留语言缩进，Markdown 继续列表", async ({ page }) => {
  await createBlankDocument(page, "语言缩进");
  const picker = page.getByRole("combobox", { name: "文件格式", exact: true });
  await picker.selectOption("c");
  const area = page.locator(".cm-content");
  await replaceSource(area, "int main() {}");
  await selectSource(area, 12);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int main() {\n\t\n}");
  await picker.selectOption("python");
  await replaceSource(area, "if True:");
  await selectSource(area, 8);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("if True:\n\t");
  await picker.selectOption("markdown");
  await replaceSource(area, "- item");
  await selectSource(area, 6);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("- item\n- ");
});


test("源码状态栏配置缩进、转换并撤销，重开保留配置，只读禁止转换", async ({ page }) => {
  await createBlankDocument(page, "缩进选项");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const area = page.locator(".cm-content");
  const size = page.getByRole("combobox", { name: "Tab Size", exact: true });
  const style = page.getByRole("combobox", { name: "缩进方式", exact: true });
  await expect(size).toHaveValue("4");
  await expect(style).toHaveValue("tabs");
  const format = page.getByRole("combobox", { name: "文件格式", exact: true });
  const [sizeBox, styleBox, formatBox] = await Promise.all([
    size.boundingBox(), style.boundingBox(), format.boundingBox(),
  ]);
  expect(sizeBox).not.toBeNull();
  expect(styleBox).not.toBeNull();
  expect(formatBox).not.toBeNull();
  expect(sizeBox!.x).toBeLessThan(styleBox!.x);
  expect(styleBox!.x).toBeLessThan(formatBox!.x);
  const raw = '    int n;\n\tprintf("a  b");';
  await replaceSource(area, raw);
  await style.selectOption("spaces");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe('    int n;\n    printf("a  b");');
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await style.selectOption("tabs");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe('\tint n;\n\tprintf("a  b");');
  await size.selectOption("2");
  await replaceSource(area, "int main() {}");
  await selectSource(area, 12);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int main() {\n\t\n}");
  await style.selectOption("spaces");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int main() {\n  \n}");
  await size.selectOption("8");
  await replaceSource(area, "value");
  await selectSource(area, 0);
  await page.keyboard.press("Tab");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("        value");
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content.metadata?.sourceText;
  })).toBe("        value");
  await page.reload();
  await expect(size).toHaveValue("8");
  await expect(style).toHaveValue("spaces");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect(size).toBeDisabled();
  await expect(style).toBeDisabled();
});

test("源码自动缩进支持选区和全文，并可作为单次撤销", async ({ page }) => {
  await createBlankDocument(page, "自动缩进");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const area = page.locator(".cm-content");
  const raw = "int main() {\nint value = 1;\nif (value) {\nvalue++;\n}\n}";
  await replaceSource(area, raw);
  const selectionCommand = page.getByRole("button", { name: "自动缩进选区", exact: true });
  await expect(selectionCommand).toBeDisabled();
  await page.getByRole("button", { name: "自动缩进全文", exact: true }).click();
  const formatted = "int main() {\n\tint value = 1;\n\tif (value) {\n\t\tvalue++;\n\t}\n}";
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(formatted);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);

  await selectSource(area, raw.indexOf("int value"), raw.indexOf("\n}\n}") + 2);
  await expect(selectionCommand).toBeEnabled();
  await selectionCommand.click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(
    "int main() {\n\tint value = 1;\n\tif (value) {\n\t\tvalue++;\n\t}\n}",
  );
});

test("C++ 自动缩进在成员定义后保留类作用域", async ({ page }) => {
  await createBlankDocument(page, "C++ 类缩进");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
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
  await expect.poll(async () => (await sourceInfo(area)).value).toBe([
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
  ].join("\n"));
});
