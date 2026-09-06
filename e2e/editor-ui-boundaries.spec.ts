import { expect, test, type Page } from "@playwright/test";

async function seedNotes(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { localDateKey } = await load("/src/lib/local-date.ts");
    const notes = [];
    for (const title of ["拆分验证甲", "拆分验证乙"]) {
      notes.push(await api.notes.create({ title, date: localDateKey(), content: { ops: [{ insert: `${title}正文` }, { insert: "\n" }] } }));
    }
    localStorage.setItem("nr:sidebarTab", "daily");
    localStorage.setItem("nr:sidebarHidden", "false");
    localStorage.setItem("nr:lastNote", notes[0].id);
    localStorage.setItem("nr:workspaceTarget", JSON.stringify({ kind: "note", noteId: notes[0].id }));
    return notes.map((note: { id: string }) => note.id);
  });
  await page.reload();
  // Exercise actual navigation; startup restoration is covered separately.
  await page.locator(".sidebar-item").filter({ hasText: "拆分验证甲" }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("拆分验证甲正文");
  return ids;
}

async function selectLine(page: Page, text: string) {
  const editor = page.locator(".ProseMirror");
  await editor.locator("p").first().click();
  await editor.press("End");
  await editor.press("Shift+Home");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

test("切换工具栏布局和插入弹层不重建正文，选区格式与撤销历史保留", async ({ page }) => {
  await seedNotes(page);
  const editor = page.locator(".ProseMirror");
  const original = await editor.elementHandle();
  if (!original) throw new Error("editor not mounted");
  await page.setViewportSize({ width: 390, height: 850 });
  await page.locator(".sidebar-tab-hide").click();
  await selectLine(page, "拆分验证甲正文");
  await page.getByTitle("样式", { exact: true }).click();
  await page.getByRole("button", { name: "B 加粗", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("拆分验证甲正文");

  await page.getByTitle("更多编辑操作").click();
  const more = page.getByRole("dialog", { name: "更多编辑操作", exact: true });
  await more.getByRole("button", { name: "🔗 添加或编辑链接", exact: true }).click();
  const dialog = page.locator(".image-dialog");
  await expect(dialog.locator("input")).toBeFocused();
  await dialog.locator("input").fill("https://example.com/cancelled");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator("a")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.locator(".editor-menu")).toHaveClass(/toolbar-full/);
  await page.getByTitle("插入图片", { exact: true }).click();
  await expect(dialog.locator("input")).toBeFocused();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByTitle("撤销 (Ctrl+Z)", { exact: true }).click();
  await expect(editor.locator("strong")).toHaveCount(0);
  await expect(editor).toHaveText("拆分验证甲正文");
  await page.getByTitle("重做 (Ctrl+Y)", { exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("拆分验证甲正文");
  expect(await original.evaluate((element) => element === document.querySelector(".ProseMirror"))).toBe(true);
  await expect(editor).toHaveCount(1);
  await original.dispose();
});

test("切换文档后右键菜单和链接对话框只更新当前文档", async ({ page }) => {
  const ids = await seedNotes(page);
  const editor = page.locator(".ProseMirror");
  for (const title of ["拆分验证甲", "拆分验证乙"]) {
    await page.locator(".sidebar-item").filter({ hasText: title }).click();
    await expect(editor).toHaveText(`${title}正文`);
    await selectLine(page, `${title}正文`);
    await editor.evaluate((element) => element.dispatchEvent(new MouseEvent("contextmenu", {
      clientX: 500, clientY: 260, bubbles: true, cancelable: true, view: window,
    })));
    const menu = page.locator(".editor-context-menu");
    await menu.getByRole("button", { name: "插入", exact: true }).click();
    await menu.getByRole("button", { name: "链接", exact: true }).click();
    const dialog = page.locator(".image-dialog");
    const href = title.endsWith("甲") ? "https://example.com/first" : "https://example.com/second";
    await dialog.locator("input").fill(href);
    await dialog.getByRole("button", { name: "插入", exact: true }).click();
    await expect(editor.locator("a")).toHaveAttribute("href", href);
    await expect(editor.locator("a")).toHaveText(`${title}正文`);
    await expect(page.locator(".save-status-saved")).toBeVisible();
  }
  const saved = await page.evaluate(async (noteIds) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    return Promise.all(noteIds.map((id) => api.notes.get(id)));
  }, ids);
  expect(JSON.stringify(saved[0].content)).toContain("https://example.com/first");
  expect(JSON.stringify(saved[0].content)).not.toContain("https://example.com/second");
  expect(JSON.stringify(saved[1].content)).toContain("https://example.com/second");
  expect(JSON.stringify(saved[1].content)).not.toContain("https://example.com/first");
});
