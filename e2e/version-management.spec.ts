import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

test("历史预览对比、多选删除与保留最近版本不改变当前正文", async ({ page }) => {
  await createBlankDocument(page);
  const noteId = await page.evaluate(async () => {
    const { idbAdapter: db } = await import("/src/lib/storage/idb.ts");
    const id = localStorage.getItem("nr:lastNote")!;
    for (let n = 0; n < 6; n++) {
      await db.updateNote(id, { title: `历史标题 ${n}`, content: { ops: [{ insert: `正文版本 ${n}\n` }] } });
      await db.createNoteCheckpoint(id);
    }
    await db.updateNote(id, { content: { ops: [{ insert: "当前正文\n" }] } });
    return id;
  });
  await page.getByRole("button", { name: "打开本机版本历史" }).click();
  const dialog = page.getByRole("dialog", { name: "版本历史", exact: true });
  await expect(dialog.locator(".version-item")).toHaveCount(6);
  await dialog.getByRole("button", { name: "预览", exact: true }).first().click();
  const preview = dialog.getByRole("region", { name: "历史版本预览" });
  await expect(preview.locator(".document-comparison")).toBeVisible();
  await expect(preview.locator(".document-comparison")).toContainText("正文版本");
  await expect(preview.locator(".document-comparison")).toContainText("当前正文");
  await expect(preview.locator(".document-diff-line.removed")).toContainText("正文版本");
  await expect(preview.locator(".document-diff-line.added")).toContainText("当前正文");
  await preview.getByRole("button", { name: "仅预览历史版本" }).click();
  await expect(preview.locator(".document-comparison")).toHaveCount(0);
  await expect(preview.getByText(/正文版本 \d/)).toBeVisible();
  await preview.getByRole("button", { name: "与当前版本对比" }).click();
  await expect(preview.locator(".document-comparison")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /^选择历史/ }).first().check();
  await dialog.getByRole("button", { name: "删除选中（1）" }).click();
  await expect(page.getByText("当前文档不会改变", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog.locator(".version-item")).toHaveCount(6);
  await dialog.getByRole("button", { name: "删除选中（1）" }).click();
  await page.getByRole("button", { name: "删除选中历史", exact: true }).click();
  await expect(dialog.locator(".version-item")).toHaveCount(5);
  await dialog.getByLabel("保留版本数").selectOption("3");
  await dialog.getByRole("button", { name: "清理更早版本" }).click();
  await page.getByRole("button", { name: "删除选中历史", exact: true }).click();
  await expect(dialog.locator(".version-item")).toHaveCount(3);
  const body = await page.evaluate(async id => (await (await import("/src/lib/storage/idb.ts")).idbAdapter.getNote(id))?.content, noteId);
  expect(body).toEqual({ ops: [{ insert: "当前正文\n" }] });
  await dialog.getByRole("button", { name: "恢复", exact: true }).first().click();
  await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "打开本机版本历史" }).click();
  await expect(dialog.locator(".version-item")).toHaveCount(4);
  await dialog.getByRole("button", { name: "预览", exact: true }).first().click();
  await expect(dialog.getByRole("region", { name: "历史版本预览" }).locator(".document-comparison")).toContainText("当前正文");
});
