import { expect, test } from "@playwright/test";

test("文档树选中前后字重及文字尺寸不变，保留选中背景", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const title = "文档树布局稳定性 Long document name";
  await page.evaluate(async title => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    await api.notes.create({ title, date: "2026-09-09", storagePath: "references", docType: "reference", content: { ops: [{ insert: "正文\n" }] } });
  }, title);
  await page.reload();
  const name = page.locator(".app-sidebar .doc-tree-name").getByText(title, { exact: true });
  await expect(name).toBeVisible();
  const geometry = () => name.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const row = element.closest(".doc-tree-doc")!;
    return { weight: getComputedStyle(element).fontWeight, textWidth: range.getBoundingClientRect().width, rowHeight: row.getBoundingClientRect().height };
  });
  const before = await geometry();
  await name.click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(name.locator("..")).toHaveClass(/doc-tree-selected/);
  expect(await geometry()).toEqual(before);
  expect(before.weight).toBe("400");
  expect(await name.locator("..").evaluate(row => getComputedStyle(row).boxShadow)).not.toBe("none");
});
