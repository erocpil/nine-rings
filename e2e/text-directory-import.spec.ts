import { expect, test } from "@playwright/test";
import path from "node:path";

test("目录导入保留所选根目录、嵌套层级和纯文本格式，跳过非文本类型", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await page.getByLabel("Markdown 导入目标路径").fill("references/folder-test");
  await page
    .getByLabel("导入文本目录")
    .setInputFiles(path.resolve("e2e/fixtures/text-import-tree"));
  await expect(page.getByText("已导入 3 篇笔记")).toBeVisible();
  await expect(page.getByText(/文本导入完成：3 篇.*跳过 1/)).toBeVisible();
  const notes = await page.evaluate(async () => {
    const load = (file: string) => import(/* @vite-ignore */ file);
    const { getAdapter } = await load("/src/lib/storage/index.ts");
    return (await getAdapter()).searchDocs({
      storagePath: "references/folder-test",
    });
  });
  expect(notes).toHaveLength(3);
  expect(
    notes.map((note: { storagePath: string }) => note.storagePath).sort(),
  ).toEqual([
    "references/folder-test/text-import-tree",
    "references/folder-test/text-import-tree/网络",
    "references/folder-test/text-import-tree/网络/深入",
  ]);
  const plain = notes.find(
    (note: { title: string }) => note.title === "根文件",
  );
  expect(plain.content.ops).toEqual([
    { insert: "# literal heading" }, { insert: "\n" },
    { insert: "**literal bold**" }, { insert: "\n" },
    { insert: "中文纯文本" }, { insert: "\n" },
  ]);
  expect(
    notes
      .find((note: { title: string }) => note.title === "目录导入概览")
      .content.ops.some(
        (op: { attributes?: { bold?: boolean } }) => op.attributes?.bold,
      ),
  ).toBe(true);
});

test("多选纯文本允许个别失败，UTF-16 正确解码且同一批文件可以再次选择", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  const input = page.locator('input[type="file"][accept^=".md,"]');
  const files = [
    {
      name: "literal.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("# literal\r\n**not bold**"),
    },
    {
      name: "中文.txt",
      mimeType: "text/plain",
      buffer: Buffer.concat([
        Buffer.from([255, 254]),
        Buffer.from("UTF-16 中文", "utf16le"),
      ]),
    },
    {
      name: "binary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([0, 1, 2]),
    },
  ];
  await input.setInputFiles(files);
  await expect(page.getByText("已导入 2 篇笔记")).toBeVisible();
  await expect(page.getByText(/失败 1 篇：binary.txt.*二进制/)).toBeVisible();
  await input.setInputFiles(files);
  await expect(page.getByText("已导入 2 篇笔记")).toBeVisible();
});
