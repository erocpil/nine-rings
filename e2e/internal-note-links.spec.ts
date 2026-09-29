import { expect, test } from "@playwright/test";

test("独立文档可用 [[ 建立稳定链接并在编辑和只读视图打开", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const date = "2026-09-29";
    const target = await api.notes.create(buildTextImportInput({ fileName: "second.md", source: "# 第二份文档\n\n目标正文。\n" }, { mode: "document", storagePath: "references/other", date }));
    const source = await api.notes.create(buildTextImportInput({ fileName: "first.md", source: "# 第一份文档\n\n引用：\n" }, { mode: "document", storagePath: "ideas", date }));
    useNotesStore.getState().selectNote(source);
    return { source: source.id, target: target.id };
  });
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(page.locator(".note-title")).toHaveValue("第一份文档");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("[[");
  await expect(page.locator(".wiki-dropdown .wiki-item")).toContainText(["第二份文档"]);
  await page.keyboard.type("第二份");
  await expect(page.locator(".wiki-dropdown .wiki-item", { hasText: "第二份文档" })).toBeVisible();
  await page.locator(".wiki-dropdown .wiki-item", { hasText: "第二份文档" }).click();
  const link = editor.locator(`a[href="nr-note://${ids.target}"]`);
  await expect(link).toHaveText("第二份文档");
  await link.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(ids.target);

  await page.evaluate(async ({ source, target }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.get(source);
    if (!note) throw new Error("source missing");
    await api.notes.update(source, { readonly: true });
    await api.notes.update(target, { title: "已改名的目标" });
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    useNotesStore.getState().selectNote(await api.notes.get(source));
  }, ids);
  await page.reload();
  await expect(page.locator(".vr-note")).toBeVisible();
  await page.locator(`.vr-note a[href="nr-note://${ids.target}"]`).click();
  await expect(page.locator(".note-title")).toHaveValue("已改名的目标");
});

test("长文档滚动后及软换行后输入 [[ 仍显示候选", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    await api.notes.create(buildTextImportInput({ fileName: "target.md", source: "# 可查找目标\n" }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    const body = Array.from({ length: 100 }, (_, index) => `段落 ${index}`).join("\n\n");
    const source = await api.notes.create(buildTextImportInput({ fileName: "long.md", source: `# 长文档\n\n${body}\n\n第一行  \n第二行后续文本\n` }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    useNotesStore.getState().selectNote(source);
  });
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(page.locator(".note-title")).toHaveValue("长文档");
  await editor.locator("p").last().click();
  await page.keyboard.press("Home");
  await page.keyboard.type("[[");
  await expect(page.locator(".wiki-dropdown")).toBeVisible();
  await expect(page.locator(".wiki-dropdown")).toBeInViewport();
  await expect(page.locator(".wiki-dropdown .wiki-item", { hasText: "可查找目标" })).toBeVisible();
  await expect(page.locator(".wiki-dropdown .wiki-item", { hasText: "可查找目标" })).toBeInViewport();
});

test("只读文档切换为可编辑后输入 [[ 显示候选", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    await api.notes.create(buildTextImportInput({ fileName: "target.md", source: "# 可查找目标\n" }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    const note = await api.notes.create(buildTextImportInput({ fileName: "source.md", source: "# 原只读文档\n\n正文\n" }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    useNotesStore.getState().selectNote(await api.notes.update(note.id, { readonly: true }));
  });
  await expect(page.locator(".note-title")).toHaveValue("原只读文档");
  await page.getByRole("button", { name: "点击设为可编辑" }).click();
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("[[");
  await expect(page.locator(".wiki-dropdown .wiki-item", { hasText: "可查找目标" })).toBeVisible();
});

test("段落中行内换行后的中间位置也能插入文档链接", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  const targetId = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const target = await api.notes.create(buildTextImportInput({ fileName: "target.md", source: "# 可查找目标\n" }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    const source = await api.notes.create(buildTextImportInput({ fileName: "source.md", source: "# 源文档\n\n第一行\n" }, { mode: "document", storagePath: "ideas", date: "2026-09-29" }));
    useNotesStore.getState().selectNote(source);
    return target.id;
  });
  await expect(page.locator(".note-title")).toHaveValue("源文档");
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "第一行" }, { type: "hardBreak" }, { type: "text", text: "第二行后续文本" },
    ] }] });
    editor.commands.setTextSelection(1 + "第一行".length + 1);
    editor.view.focus();
  });
  await expect(page.locator(".note-editor .ProseMirror p br")).toHaveCount(1);
  await page.keyboard.type("[[");
  await expect(page.locator(".wiki-dropdown .wiki-item", { hasText: "可查找目标" })).toBeVisible();
  await page.locator(".wiki-dropdown .wiki-item", { hasText: "可查找目标" }).click();
  await expect(page.locator(`.note-editor .ProseMirror a[href="nr-note://${targetId}"]`)).toHaveText("可查找目标");
  await expect(page.locator(".note-editor .ProseMirror p")).toHaveText("第一行可查找目标第二行后续文本");
});

test("[[ 优先显示最近浏览文档，Escape 关闭当前候选直到再次输入 [[", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const make = (name: string) => buildTextImportInput({ fileName: `${name}.md`, source: `# ${name}\n\n正文\n` }, { mode: "document", storagePath: "ideas", date: "2026-09-29" });
    const visited = await api.notes.create(make("最近浏览"));
    await api.notes.create(make("较新编辑"));
    const source = await api.notes.create(make("当前文档"));
    localStorage.setItem("nr:recentNotes", JSON.stringify([visited.id]));
    useNotesStore.getState().selectNote(source);
  });
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(page.locator(".note-title")).toHaveValue("当前文档");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("[[");
  const choices = page.locator(".wiki-dropdown .wiki-item");
  await expect(choices.first()).toContainText("最近浏览");
  await page.keyboard.press("Escape");
  await expect(page.locator(".wiki-dropdown")).toHaveCount(0);
  await expect(editor).toContainText("[[");
  await page.keyboard.type("较新");
  await expect(page.locator(".wiki-dropdown")).toHaveCount(0);
  await page.keyboard.type(" [[");
  await expect(choices).toContainText(["最近浏览", "较新编辑"]);
});
