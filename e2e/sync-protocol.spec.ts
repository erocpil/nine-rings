import { expect, test } from "@playwright/test";

test("unsupported envelope import cannot replace documents or settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const before = JSON.parse(await api.export.data());
    localStorage.setItem("nr:focusMode", "false");
    const messages: string[] = [];
    for (const header of [null, { kind: "nine-rings.sync-snapshot", format: 99 }]) {
      try {
        await api.export.import(JSON.stringify({ version: 1, header, notes: [], user_settings: { version: 1, values: { "nr:focusMode": true } } }), "replace");
        messages.push("unexpected success");
      } catch (error) { messages.push((error as Error).message); }
    }
    const after = JSON.parse(await api.export.data());
    return { messages, notesUnchanged: JSON.stringify(before.notes) === JSON.stringify(after.notes), focus: localStorage.getItem("nr:focusMode") };
  });
  expect(result.messages).toHaveLength(2);
  for (const message of result.messages) expect(message).toContain("同步协议");
  expect(result.notesUnchanged).toBe(true);
  expect(result.focus).toBe("false");
  await expect(page.locator(".ProseMirror")).toBeVisible();
});
