import { expect, test } from "@playwright/test";
import { documentSizeBytes, formatDocumentSize } from "../src/lib/document-size";

test("路径目录列表和文档属性显示一致的正文大小", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const content = { ops: [{ insert: "正文大小检查：中文与 English 🌱" }, { insert: "\n" }] };
  const id = await page.evaluate(async content => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "正文大小测试文档",
      storagePath: "tests/document-size",
      date: useNotesStore.getState().currentDate,
      content,
    });
    useNotesStore.getState().selectNote(note);
    return note.id;
  }, content);
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("正文大小测试文档");

  const folder = page.locator(".app-sidebar .doc-tree-folder").filter({
    has: page.locator(".doc-tree-name", { hasText: /^document-size$/ }),
  });
  await folder.locator(".doc-tree-name").click();
  const row = page.locator(".moc-row").filter({ hasText: "正文大小测试文档" });
  const expectedSize = formatDocumentSize(documentSizeBytes(content));
  await expect(row.locator(".moc-col-size")).toHaveText(expectedSize);
  const columnWidths = await page.locator(".moc-table").evaluate(table => Object.fromEntries(
    ["title", "concepts", "links", "size"].map(name => [
      name,
      table.querySelector<HTMLElement>(`.moc-col-${name}`)!.getBoundingClientRect().width,
    ]),
  ));
  expect(columnWidths.title).toBeGreaterThan(columnWidths.concepts);
  expect(columnWidths.concepts).toBeLessThan(80);
  expect(columnWidths.links).toBeLessThan(80);
  expect(columnWidths.size).toBeLessThan(100);
  expect(await page.locator(".moc-table th").evaluateAll(headers =>
    headers.every(header => getComputedStyle(header).whiteSpace === "nowrap"),
  )).toBe(true);
  const tableFill = await page.locator(".moc-table").evaluate(table => ({
    table: table.getBoundingClientRect().width,
    available: table.parentElement!.clientWidth,
  }));
  expect(tableFill.table).toBeGreaterThanOrEqual(tableFill.available - 2);

  await row.click();
  await expect(page.locator(".note-title")).toHaveValue("正文大小测试文档");
  if (!await page.locator(".properties-panel").isVisible()) {
    await page.getByTitle("显示属性面板", { exact: true }).click();
  }
  const propertySize = page.locator('.properties-panel [aria-label="文档大小"] .prop-empty');
  await expect(propertySize).toHaveText(expectedSize);

  await page.locator(".note-editor .ProseMirror").fill("更新后的正文，包含更多中文内容。".repeat(6));
  const readStoredSize = () => page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ api }, { documentSizeBytes, formatDocumentSize }] = await Promise.all([
      load("/src/lib/api.ts") as Promise<typeof import("../src/lib/api")>,
      load("/src/lib/document-size.ts") as Promise<typeof import("../src/lib/document-size")>,
    ]);
    const note = await api.notes.get(id);
    return formatDocumentSize(documentSizeBytes(note?.content));
  }, id);
  await expect.poll(readStoredSize).not.toBe(expectedSize);
  const updatedSize = await readStoredSize();
  await expect.poll(() => propertySize.textContent()).toBe(updatedSize);
  expect(id).toBeTruthy();
});
