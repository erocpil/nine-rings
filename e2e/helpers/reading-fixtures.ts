import { expect, type Page } from "@playwright/test";

type Result = { a: string; b: string } | { error: string };
type FixtureWindow = Window & {
  readingFixture?: { task?: Promise<void>; result?: Result };
};

/** Run initialization in-page and poll plain results, avoiding collected CDP promises. */
export async function seedReadingDocuments(
  page: Page,
  readonly = false,
  encrypted = false,
) {
  await page.evaluate(
    ({ locked, encrypted }) => {
      const state: NonNullable<FixtureWindow["readingFixture"]> = {};
      (window as FixtureWindow).readingFixture = state;
      state.task = (async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = (await load(
          "/src/lib/api.ts",
        )) as typeof import("../../src/lib/api");
        const { mdToDelta } = (await load(
          "/src/lib/md-parser.ts",
        )) as typeof import("../../src/lib/md-parser");
        const { useNotesStore } = (await load(
          "/src/stores/useNotesStore.ts",
        )) as typeof import("../../src/stores/useNotesStore");
        const markdown =
          "# 首节\n\n首节隐藏正文\n\n# 第二节\n\n```js\nconst example = 1;\n```\n\n" +
          Array.from(
            { length: 90 },
            (_, i) => `阅读段落 ${i} ${"正文".repeat(30)}`,
          ).join("\n\n");
        let content = mdToDelta(markdown);
        if (encrypted) {
          const { createDocumentKey, encryptDocument } = (await load(
            "/src/lib/document-crypto.ts",
          )) as typeof import("../../src/lib/document-crypto");
          content = await encryptDocument(
            content,
            await createDocumentKey("reading-password-123"),
          );
        }
        const a = await api.notes.create({
          title: "折叠位置 A",
          date: "2026-09-17",
          storagePath: "references/fold-session",
          content,
        });
        const b = await api.notes.create({
          title: "折叠位置 B",
          date: "2026-09-17",
          storagePath: "references/fold-session",
          content: mdToDelta("其它文档"),
        });
        const selected = locked
          ? await api.notes.update(a.id, { readonly: true })
          : a;
        if (encrypted) {
          // Simulate an old plaintext viewing record before mounting a now-protected document.
          localStorage.setItem(
            `nr:readingState:${a.id}`,
            JSON.stringify({ version: 1, headings: ["old-private-heading"] }),
          );
          localStorage.setItem(`scrollPos:${a.id}`, "400");
        }
        useNotesStore.getState().selectNote(selected);
        state.result = { a: a.id, b: b.id };
      })().catch((error) => {
        state.result = { error: String(error) };
      });
    },
    { locked: readonly, encrypted },
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as FixtureWindow).readingFixture?.result),
      ),
    )
    .toBe(true);
  const result = await page.evaluate(() => {
    const result = (window as FixtureWindow).readingFixture?.result;
    delete (window as FixtureWindow).readingFixture;
    return result;
  });
  if (!result || "error" in result)
    throw new Error(result?.error ?? "reading fixture did not complete");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .toBe(result.a);
  if (encrypted)
    await expect(
      page.getByRole("region", { name: "加密文档", exact: true }),
    ).toBeVisible();
  else {
    await expect(page.locator(".ProseMirror")).toContainText("首节隐藏正文");
    await expect(page.locator(".ProseMirror")).toContainText("阅读段落 89");
    await expect(page.locator(".ProseMirror")).toHaveAttribute(
      "contenteditable",
      String(!readonly),
    );
  }
  return result;
}
