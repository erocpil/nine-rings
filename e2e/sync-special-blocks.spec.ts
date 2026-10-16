import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const width of [1280, 390])
  for (const virtual of [false, true]) {
    test(`特殊块保存认证、只读刷新和源码预览 ${width} virtual=${virtual}`, async ({
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
      await createBlankDocument(page, "特殊块认证");
      await page
        .locator(".note-editor .ProseMirror")
        .evaluate(async (element) => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { default: fixture } = await load(
            "/schema/sync/fixtures/candidate-special-blocks-v1.json",
          );
          const { deltaToProseMirror } = await load(
            "/src/lib/delta-converter.ts",
          );
          const { createReferenceAnchor } = await load(
            "/src/extensions/ReferenceAnchors.ts",
          );
          const editor = (
            element as HTMLElement & { editor: import("@tiptap/core").Editor }
          ).editor;
          editor.commands.setContent(
            {
              type: "doc",
              content: fixture.notes
                .slice(0, 4)
                .flatMap(
                  (note: { content: unknown }) =>
                    deltaToProseMirror(note.content).content,
                ),
            },
            true,
          );
          createReferenceAnchor(editor, "block", 0);
        });
      const saved = () =>
        page.evaluate(async () => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { api } = await load("/src/lib/api.ts");
          const { reviewCandidatePayload } = await load(
            "/src/lib/sync/candidate-write-policy.ts",
          );
          const { default: fixture } = await load(
            "/schema/sync/fixtures/candidate-special-blocks-v1.json",
          );
          const note = await api.notes.get(
            localStorage.getItem("nr:lastNote")!,
          );
          if (!note || !JSON.stringify(note.content).includes("网关源码"))
            return false;
          const review = reviewCandidatePayload(
            JSON.stringify({
              ...fixture,
              notes: [{ ...fixture.notes[0], content: note.content }],
            }),
            "web",
          );
          return (
            review.eligible &&
            [
              "mermaid-block-v1",
              "flow-block-v1",
              "automatic-toc-v1",
              "math-v1",
            ].every((feature) => review.requiredFeatures.includes(feature)) &&
            note.content.metadata?.referenceAnchors?.length === 1
          );
        });
      await expect.poll(saved).toBe(true);
      // Avoid a desktop sidebar covering the mobile document after resizing.
      await page
        .getByRole("navigation", { name: "工作区面板" })
        .getByRole("button", { name: "文档树", exact: true })
        .click();
      await page.setViewportSize({ width, height: 900 });
      const root = page.locator(".note-editor");
      const diagram = root
        .locator(".code-block-wrap")
        .filter({ has: page.locator("[data-mermaid-controls]") })
        .first();
      await diagram.scrollIntoViewIfNeeded();
      await diagram
        .getByRole("button", { name: "展开代码块", exact: true })
        .click();
      await expect(diagram.locator(".mermaid-diagram svg")).toBeVisible();
      await root.locator(".flow-block-wrap").scrollIntoViewIfNeeded();
      await expect(root.locator(".flow-step")).toHaveCount(2);
      await expect(
        root.getByRole("navigation", { name: "文档内目录" }).getByRole("link"),
      ).toHaveCount(3);
      await root.locator(".nr-math").first().scrollIntoViewIfNeeded();
      await expect(root.locator(".katex")).toHaveCount(3);
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
      await expect.poll(saved).toBe(true);
      await page.reload();
      await expect.poll(saved).toBe(true);
      await root.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, -10000);
      await root.locator(".flow-block-wrap").scrollIntoViewIfNeeded();
      await expect(root.locator(".flow-step")).toHaveCount(2);
      if (width === 1280) {
        await page.getByRole("button", { name: "源码", exact: true }).click();
        if (!(await page.locator(".markdown-preview-scroll").count()))
          await page
            .getByRole("button", { name: "并排预览", exact: true })
            .click();
        const preview = page.locator(".markdown-preview-scroll");
        await preview.locator(".flow-block-wrap").scrollIntoViewIfNeeded();
        await expect(preview.locator(".flow-step")).toHaveCount(2);
        await expect(
          preview
            .getByRole("navigation", { name: "文档内目录" })
            .getByRole("link"),
        ).toHaveCount(3);
        await expect(preview.locator(".katex")).toHaveCount(3);
      }
    });
  }
