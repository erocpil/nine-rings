import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function fixture(page: Page, virtual = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20000 });
  await page.evaluate(async (virtual) => {
    const load = (p: string) =>
      import(
        /* @vite-ignore */ performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((u) => new URL(u).pathname === p) ?? p
      );
    const { api } = await load("/src/lib/api.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const p = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const code = (text: string) => ({
      type: "codeBlock",
      attrs: { language: "python" },
      content: [{ type: "text", text }],
    });
    const note = await api.notes.create({
      title: "布局与缩进验证",
      storagePath: "tests",
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "章节" }],
          },
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [p("列表条目")] }],
          },
          code("print(1)"),
          { type: "blockquote", content: [p("列表补充说明")] },
          code("print(2)"),
          p("独立正文"),
          code("print(3)"),
        ],
      },
    });
    if (virtual) {
      localStorage.setItem("nr:experimentalReadonlyRendering", "true");
      await api.notes.update(note.id, { readonly: true });
    }
    useNotesStore.getState().selectNote(await api.notes.get(note.id));
  }, virtual);
  if (virtual)
    await expect(page.locator(".vr-title")).toContainText("布局与缩进验证");
  else await expect(page.locator(".note-title")).toHaveValue("布局与缩进验证");
}

async function display(page: Page, enabled: boolean) {
  await page.evaluate(async (enabled) => {
    const p = "/src/lib/block-display-settings.ts";
    const settings = await import(
      /* @vite-ignore */ performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((u) => new URL(u).pathname === p) ?? p
    );
    settings.saveBlockWorkspacePreferences({ listFollowupIndent: enabled });
  }, enabled);
}

test("固定的分栏、目录书签及布局在重载和手机布局往返后保留", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("nr:sidebarPresentation", "overlay"),
  );
  await fixture(page);
  const list = page.locator('[data-sidebar-panel="list"]');
  await list.click();
  await page.locator('[data-document-panel-trigger="outline"]').click();
  await page.locator('[data-document-panel-trigger="bookmark"]').click();
  await expect(list).toHaveAttribute("data-pinned", "true");
  const saved = await page.evaluate(() =>
    localStorage.getItem("nr:workspaceLayout"),
  );
  await page.mouse.move(1200, 700);
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("布局与缩进验证");
  await expect(list).toHaveAttribute("data-pinned", "true");
  await expect(
    page.locator('[data-document-panel-trigger="outline"]'),
  ).toHaveAttribute("data-pinned", "true");
  await expect(
    page.locator('[data-document-panel-trigger="bookmark"]'),
  ).toHaveAttribute("data-pinned", "true");
  await page.setViewportSize({ width: 390, height: 850 });
  await page.waitForTimeout(250);
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(list).toHaveAttribute("data-pinned", "true");
  expect(
    await page.evaluate(() => localStorage.getItem("nr:workspaceLayout")),
  ).toBe(saved);
  await list.click();
  await page.mouse.move(1200, 700);
  await page.locator('[data-sidebar-panel="reader"]').hover();
  await expect(page.locator(".app-sidebar")).not.toHaveClass(/sidebar-hidden/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  await page.reload();
  await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("nr:desktopSidebar")!).panel,
    ),
  ).toBe("list");
});

for (const virtual of [false, true])
  test(`列表后连续代码及引用缩进，开关和手机显示保留相同文档 ${virtual}`, async ({
    page,
  }) => {
    if (virtual)
      await page.addInitScript(() =>
        localStorage.setItem("nr:experimentalReadonlyRendering", "true"),
      );
    await fixture(page, virtual);
    if (virtual) await expect(page.locator(".vr-block").first()).toBeVisible();
    const blocks = page.locator(".editor-content [data-list-followup]");
    await expect(blocks).toHaveCount(3);
    await expect
      .poll(() =>
        blocks
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)),
      )
      .toBeGreaterThan(8);
    await page
      .locator(".app")
      .evaluate((el) =>
        (el as HTMLElement).style.setProperty("--editor-list-indent", "2em"),
      );
    await expect
      .poll(() =>
        blocks
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)),
      )
      .toBeGreaterThan(24);
    await display(page, false);
    await expect(blocks.first()).toHaveCSS("margin-inline-start", "0px");
    await display(page, true);
    await page.setViewportSize({ width: 390, height: 850 });
    await expect(blocks.first()).toHaveCSS("margin-inline-start", "4px");
    await page.setViewportSize({ width: 1280, height: 850 });
    await expect
      .poll(() =>
        blocks
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)),
      )
      .toBeGreaterThan(8);
    await expect(
      page.locator(".editor-content .code-block-wrap").last(),
    ).not.toHaveAttribute("data-list-followup", /.+/);
  });

test("手动引用块 Tab 与整块代码缩进保存，代码内部 Tab 不改变块层级", async ({
  page,
}) => {
  await fixture(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    let pos = 0;
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === "blockquote") pos = offset + 2;
    });
    ed.commands.focus(pos);
  });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(editor.locator("blockquote")).toHaveAttribute(
    "data-indent",
    "1",
  );
  await page.keyboard.press("Shift+Tab");
  await expect(editor.locator("blockquote")).toHaveAttribute(
    "data-indent",
    "0",
  );
  await display(page, false);
  await expect(editor.locator("blockquote")).toHaveCSS(
    "margin-inline-start",
    "0px",
  );
  await page.keyboard.press("Tab");
  await expect(editor.locator("blockquote")).toHaveAttribute(
    "data-indent",
    "1",
  );
  await display(page, true);
  await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    let pos = 0;
    ed.state.doc.forEach((node, offset) => {
      if (!pos && node.type.name === "codeBlock") pos = offset + 1;
    });
    ed.commands.setTextSelection(pos);
    ed.commands.indentBlocks();
    ed.view.focus();
  });
  const code = editor.locator(".code-block-wrap").first();
  await expect(code).toHaveAttribute("data-indent", "1");
  await page.keyboard.press("Tab");
  await expect(code.locator("code")).toHaveText("\tprint(1)");
  await expect(code).toHaveAttribute("data-indent", "1");
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "点击设为可编辑", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("布局与缩进验证");
  await expect(code).toHaveAttribute("data-indent", "1");
  await page.setViewportSize({ width: 390, height: 850 });
  await expect(editor.locator(":scope > .node-codeBlock").first()).toHaveCSS(
    "margin-inline-start",
    "4px",
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect
    .poll(() =>
      editor
        .locator(":scope > .node-codeBlock")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)),
    )
    .toBeGreaterThan(8);
});

test("列表后缩进开关可预览、取消和保存，重载后保留", async ({ page }) => {
  await fixture(page);
  const open = async () => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    await page.getByRole("button", { name: /打开排版设置/ }).click();
  };
  await open();
  const toggle = page.getByRole("checkbox", { name: "列表后的块自动缩进" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator(".list-followup-preview").first()).toHaveCSS(
    "margin-inline-start",
    "0px",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".editor-content [data-list-followup]")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)),
    )
    .toBeGreaterThan(8);
  await open();
  await toggle.uncheck();
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await page.reload();
  await expect(
    page.locator(".editor-content [data-list-followup]").first(),
  ).toHaveCSS("margin-inline-start", "0px");
});
