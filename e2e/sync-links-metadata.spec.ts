import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const width of [1280, 390])
  for (const virtual of [false, true]) {
    test(`链接 alert 元数据保存、编辑及只读恢复 ${width} virtual=${virtual}`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value) =>
          localStorage.setItem(
            "nr:experimentalReadonlyRendering",
            String(value),
          ),
        virtual,
      );
      await createBlankDocument(page, "链接元数据认证");
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { default: fixture } = await load(
          "/schema/sync/fixtures/candidate-links-metadata-v1.json",
        );
        const { api } = await load("/src/lib/api.ts");
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
        const { deltaToMarkdown } = await load(
          "/src/lib/markdown-serializer.ts",
        );
        const content = {
          ops: fixture.notes
            .slice(0, 6)
            .flatMap(
              (note: { content: { ops: unknown[] } }) => note.content.ops,
            ),
          metadata: {
            author: "作者",
            sourceFormat: "markdown",
            originalFileName: "链接.md",
            markdownSource: "",
            bookmarks: [
              {
                id: "bookmark-1",
                position: 1,
                preview: "目标",
                label: "入口",
                key: "a",
                createdAt: "2026-10-16T00:00:00.000Z",
              },
            ],
          },
        };
        content.metadata.markdownSource = deltaToMarkdown(content);
        const updated = await api.notes.create({
          date: "2026-10-16",
          title: "链接元数据认证正文",
          content,
        });
        await useNotesStore.getState().selectNote(updated);
      });
      const root = page.locator(".note-editor");
      await expect(
        root.getByRole("link", { name: "章节", exact: true }),
      ).toBeVisible();
      await expect(root.locator("blockquote[data-alert]")).toHaveCount(5);
      const review = () =>
        page.evaluate(async () => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { api } = await load("/src/lib/api.ts");
          const { default: fixture } = await load(
            "/schema/sync/fixtures/candidate-links-metadata-v1.json",
          );
          const { reviewCandidatePayload } = await load(
            "/src/lib/sync/candidate-write-policy.ts",
          );
          const note = await api.notes.get(
            localStorage.getItem("nr:lastNote")!,
          );
          if (!note?.content.metadata?.bookmarks?.length) return null;
          const r = reviewCandidatePayload(
            JSON.stringify({
              ...fixture,
              notes: [{ ...fixture.notes[0], content: note.content }],
            }),
            "web",
          );
          return {
            eligible: r.eligible,
            label: note.content.metadata.bookmarks[0].label,
            author: note.content.metadata.author,
            source: typeof note.content.metadata.markdownSource === "string",
          };
        });
      await expect
        .poll(review)
        .toEqual({
          eligible: true,
          label: "入口",
          author: "作者",
          source: true,
        });
      await root
        .locator(".ProseMirror")
        .first()
        .evaluate(async (element) => {
          const path = "/src/extensions/DocumentBookmarks.ts";
          const { renameBookmark } = await import(/* @vite-ignore */ path);
          const editor = (
            element as HTMLElement & { editor: import("@tiptap/core").Editor }
          ).editor;
          renameBookmark(editor, "bookmark-1", "改名入口");
        });
      await expect
        .poll(review)
        .toEqual({
          eligible: true,
          label: "改名入口",
          author: "作者",
          source: true,
        });
      await root
        .locator(".ProseMirror")
        .first()
        .evaluate((element) => {
          const editor = (
            element as HTMLElement & { editor: import("@tiptap/core").Editor }
          ).editor;
          editor.commands.insertContentAt(1, "更新");
        });
      await expect
        .poll(review)
        .toEqual({
          eligible: true,
          label: "改名入口",
          author: "作者",
          source: false,
        });
      await page
        .getByRole("navigation", { name: "工作区面板" })
        .getByRole("button", { name: "文档树", exact: true })
        .click();
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
      await root.getByRole("link", { name: "章节", exact: true }).click();
      await page.reload();
      await expect
        .poll(review)
        .toEqual({
          eligible: true,
          label: "改名入口",
          author: "作者",
          source: false,
        });
      await expect(root.locator("blockquote[data-alert]")).toHaveCount(5);
      await expect(
        root.getByRole("link", { name: "块引用", exact: true }),
      ).toHaveAttribute("href", /^nr-note:\/\//);
      if (width === 1280) {
        await page.getByRole("button", { name: "源码", exact: true }).click();
        if (!(await page.locator(".markdown-preview-scroll").count()))
          await page
            .getByRole("button", { name: "并排预览", exact: true })
            .click();
        const preview = page.locator(".markdown-preview-scroll");
        await expect(preview.locator("blockquote[data-alert]")).toHaveCount(5);
        await expect(
          preview.getByRole("link", { name: "网站", exact: true }).first(),
        ).toHaveAttribute("title", "说明");
      }
    });
  }
