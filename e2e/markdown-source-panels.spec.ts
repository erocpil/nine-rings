import { expect, test, type Locator, type Page } from "@playwright/test";

async function replace(page: Page, area: Locator, old: string, value: string) {
  await area.evaluate((element, old) => {
    const input = element as HTMLTextAreaElement;
    const from = old ? input.value.indexOf(old) : 0;
    if (from < 0) throw new Error(`Missing text ${old}`);
    input.focus();
    input.setSelectionRange(from, from + old.length);
  }, old);
  await page.keyboard.insertText(value);
}

for (const virtual of [false, true])
  test(`源码保留固定目录书签，实时更新并保存位置 ${virtual ? "局部只读入口" : "编辑入口"}`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const noteId = await page.evaluate(async (virtual) => {
      const load = (path: string) =>
        import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
      const { api } = await load("/src/lib/api.ts");
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
      const { renderedTextblockMap } = await load(
        "/src/lib/markdown-view-position.ts",
      );
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const { setReadonlyRenderingEnabled } = await load(
        "/src/lib/readonly-rendering.ts",
      );
      const { saveWorkspaceLayout } = await load(
        "/src/lib/workspace-layout.ts",
      );
      saveWorkspaceLayout({
        panelsSide: virtual ? "left" : "right",
        panelsArrangement: virtual ? "horizontal" : "vertical",
      });
      const source =
        "# 起始\n\n第一段\n\n## 旧标题\n\n目标书签正文\n\n" +
        Array.from(
          { length: 40 },
          (_, i) => `## 章节${i}\n\n${"这里是正文。".repeat(8)}`,
        ).join("\n\n");
      const content = mdToDelta(source);
      const block = renderedTextblockMap(deltaToProseMirror(content)).find(
        (entry: { text: string }) => entry.text === "目标书签正文",
      );
      content.metadata = {
        sourceFormat: "markdown",
        markdownSource: source,
        bookmarks: [
          {
            id: "source-bookmark",
            position: block.position + 1,
            preview: "目标书签正文",
            createdAt: "2026-01-01",
          },
        ],
      };
      let note = await api.notes.create({
        title: "源码面板验证",
        date: useNotesStore.getState().currentDate,
        storagePath: "tests",
        content,
      });
      if (virtual) note = await api.notes.update(note.id, { readonly: true });
      setReadonlyRenderingEnabled(virtual);
      useNotesStore.getState().selectNote(note);
      return note.id;
    }, virtual);
    await expect(
      page.locator(virtual ? ".vr-title" : ".note-title"),
    ).toBeVisible();
    for (const name of ["文档目录", "文档书签"])
      await page.getByRole("button", { name, exact: true }).click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const area = page.getByRole("textbox", {
      name: "Markdown 源码",
      exact: true,
    });
    await expect(area).toBeVisible();
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    await expect(dock).toHaveClass(
      virtual ? /dock-left dock-horizontal/ : /dock-right dock-vertical/,
    );
    const source = await area.inputValue();
    await dock
      .locator(".document-outline-text")
      .filter({ hasText: /^章节30$/ })
      .click();
    await expect
      .poll(() =>
        area.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
      )
      .toBe(source.indexOf("## 章节30"));
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await dock.locator(".document-bookmark-jump").click();
    await expect
      .poll(() =>
        area.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
      )
      .toBe(source.indexOf("目标书签正文"));
    await page.getByRole("button", { name: "后退", exact: true }).click();
    await expect(area).toBeVisible();
    await expect
      .poll(() =>
        area.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
      )
      .toBe(source.indexOf("## 章节30"));
    await page.getByRole("button", { name: "前进", exact: true }).click();
    await expect
      .poll(() =>
        area.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
      )
      .toBe(source.indexOf("目标书签正文"));
    if (virtual) {
      await expect(area).toHaveAttribute("readonly", "");
      await page
        .getByRole("button", { name: "切换为可编辑", exact: true })
        .click();
      await expect(area).not.toHaveAttribute("readonly", "");
    }
    await replace(page, area, "", "# 新增章节\n\n新增正文\n\n");
    await replace(page, area, "旧标题", "更新标题");
    await replace(page, area, "目标书签正文", "目标书签正文已经更新");
    await expect(
      dock.locator(".document-outline-text").filter({ hasText: /^新增章节$/ }),
    ).toBeVisible();
    await expect(
      dock.locator(".document-outline-text").filter({ hasText: /^更新标题$/ }),
    ).toBeVisible();
    await expect(
      dock.locator(".document-outline-text").filter({ hasText: /^旧标题$/ }),
    ).toHaveCount(0);
    await expect(dock.locator(".document-bookmark-jump")).toContainText(
      "目标书签正文已经更新",
    );
    await dock.locator(".document-bookmark-jump").click();
    const changed = await area.inputValue();
    await expect
      .poll(() =>
        area.evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
      )
      .toBe(changed.indexOf("目标书签正文已经更新"));
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toContainText(
      "目标书签正文已经更新",
    );
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    await expect(dock.locator(".document-bookmark-jump")).toContainText(
      "目标书签正文已经更新",
    );
    const saved = await page.evaluate(async (noteId) => {
      const load = (path: string) =>
        import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
      const { api } = await load("/src/lib/api.ts");
      const { deltaToProseMirror } = await load("/src/lib/delta-converter.ts");
      const { renderedTextblockMap } = await load(
        "/src/lib/markdown-view-position.ts",
      );
      const note = await api.notes.get(noteId);
      const bookmark = note.content.metadata.bookmarks[0];
      return {
        bookmark,
        text: renderedTextblockMap(deltaToProseMirror(note.content)).find(
          (block: { position: number }) =>
            block.position + 1 === bookmark.position,
        )?.text,
      };
    }, noteId);
    expect(saved.bookmark.id).toBe("source-bookmark");
    expect(saved.text).toBe("目标书签正文已经更新");
    await page.reload();
    await expect(dock.locator(".document-bookmark-jump")).toContainText(
      "目标书签正文已经更新",
    );
  });
