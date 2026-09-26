import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function fixture(page: Page, kind = "text") {
  await page.addInitScript(() =>
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        editor_show_line_numbers: true,
        use_custom_context_menu: true,
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15000 });
  await page.evaluate(async (kind) => {
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
      content: text ? [{ type: "text", text }] : [],
    });
    const content =
      kind === "code"
        ? [
            {
              type: "codeBlock",
              attrs: { language: "python" },
              content: [{ type: "text", text: "\tprint(1)" }],
            },
          ]
        : kind === "list"
          ? [
              {
                type: "orderedList",
                content: Array.from({ length: 12 }, (_, i) => ({
                  type: "listItem",
                  content: [p(`第 ${i + 1} 项长内容`.repeat(10))],
                })),
              },
            ]
          : Array.from({ length: 80 }, (_, i) => p(`第 ${i + 1} 段正文`));
    const note = await api.notes.create({
      title: "编辑改进验证",
      date: useNotesStore.getState().currentDate,
      storagePath: "tests",
      content: { type: "doc", content },
    });
    useNotesStore.getState().selectNote(note);
  }, kind);
  await expect(page.locator(".note-title")).toHaveValue("编辑改进验证");
}

for (const width of [390, 1280])
  test(`全选保留长文档选区和当前位置 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await fixture(page);
    const editor = page.locator(".ProseMirror");
    for (const readonly of [false, true]) {
      if (readonly)
        await page
          .getByRole("button", { name: "点击设为只读", exact: true })
          .click();
      await editor.evaluate((el) => {
        const ed = (el as HTMLElement & { editor: Editor }).editor;
        ed.commands.setTextSelection(10);
        const root = el.closest(".note-editor-scroll")!;
        root.scrollTop = 160;
      });
      await page.waitForTimeout(200);
      await editor.evaluate((el) => {
        el.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 200,
          }),
        );
      });
      const before = await page
        .locator(".note-editor-scroll")
        .evaluate((el) => el.scrollTop);
      await page
        .locator(".editor-context-menu")
        .getByRole("button", { name: "全选", exact: true })
        .click();
      await expect
        .poll(() =>
          editor.evaluate((el) => {
            const range = document.getSelection()?.rangeCount
              ? document.getSelection()!.getRangeAt(0)
              : null;
            return range?.toString() === el.textContent;
          }),
        )
        .toBe(true);
      await page.waitForTimeout(180);
      expect(
        await page
          .locator(".note-editor-scroll")
          .evaluate((el) => el.scrollTop),
      ).toBeCloseTo(before, 0);
    }
  });

test("长有序列表通过连续 Enter 和软键盘换行退出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await fixture(page, "list");
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.commands.focus("end");
  });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor.locator("li")).toHaveCount(13);
  await page.keyboard.press("Enter");
  await expect(editor.locator(":scope > p")).toHaveCount(1);
  await expect(editor.locator("li")).toHaveCount(12);
  // Return to the end and exercise the iOS beforeinput route without keydown.
  await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    const list = ed.state.doc.firstChild!.toJSON();
    ed.commands.setContent({
      type: "doc",
      content: [
        {
          ...list,
          content: [
            ...list.content,
            { type: "listItem", content: [{ type: "paragraph" }] },
          ],
        },
      ],
    });
    ed.commands.setTextSelection(ed.state.doc.firstChild!.nodeSize - 3);
  });
  await expect(editor.locator("li")).toHaveCount(13);
  await editor.evaluate((el) => {
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertParagraph",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator(":scope > p")).toHaveCount(1);
  await expect(editor.locator("li")).toHaveCount(12);
});

test("代码 Tab 宽度在正文和块编辑器即时共用", async ({ page }) => {
  await fixture(page, "code");
  const setTabs = async (tabSize: number) =>
    page.evaluate(async (tabSize) => {
      const p = "/src/lib/block-display-settings.ts";
      const { saveBlockWorkspacePreferences } = await import(
        /* @vite-ignore */ performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((u) => new URL(u).pathname === p) ?? p
      );
      saveBlockWorkspacePreferences({ tabSize });
    }, tabSize);
  await expect(page.locator(".code-block-inner")).toHaveCSS("tab-size", "4");
  await setTabs(8);
  await expect(page.locator(".code-block-inner")).toHaveCSS("tab-size", "8");
  await page
    .getByRole("button", { name: "放大阅读代码块", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "代码块工作区" });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(dialog.locator(".cm-line").first()).toHaveCSS("tab-size", "8");
  await setTabs(2);
  await expect(dialog.locator(".cm-line").first()).toHaveCSS("tab-size", "2");
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-editor .code-block-inner")).toHaveCSS(
    "tab-size",
    "2",
  );
});

test("代码块与后续引用、代码块和正文保持间隔", async ({ page }) => {
  await fixture(page, "code");
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.commands.setContent({
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "const first = true;" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用内容" }] }] },
        { type: "codeBlock", content: [{ type: "text", text: "const second = true;" }] },
        { type: "paragraph", content: [{ type: "text", text: "普通文本" }] },
      ],
    });
  });
  await expect(editor.locator(".code-block-wrap")).toHaveCount(2);
  await expect(editor.locator(".blockquote-wrap")).toHaveCount(1);
  await expect(editor.locator("p").filter({ hasText: "普通文本" })).toHaveCount(1);
  const gaps = await editor.evaluate((el) => {
    const blocks = [...el.children] as HTMLElement[];
    return blocks.slice(0, -1).map((block, index) => {
      const next = blocks[index + 1];
      return next.getBoundingClientRect().top - block.getBoundingClientRect().bottom;
    });
  });
  expect(gaps).toHaveLength(3);
  for (const gap of gaps) expect(gap).toBeGreaterThan(0);
});

test("首次工具提示快速显示并在离开后消失", async ({ page }) => {
  await fixture(page);
  const button = page.locator(".editor-menu .menu-btn[title]").first();
  const label = await button.getAttribute("title");
  await button.hover();
  await expect(page.getByRole("tooltip")).toHaveText(label!, { timeout: 500 });
  await page.mouse.move(1, 1);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("GitHub 同步期间返回和关闭必须显式确认", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await page.evaluate(async () => {
    const p = "/src/lib/sync/push-job.ts";
    const { useGitHubPushJob } = await import(
      /* @vite-ignore */ performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((u) => new URL(u).pathname === p) ?? p
    );
    useGitHubPushJob.setState({
      status: "running",
      phase: "uploading",
      target: "test/test",
    });
  });
  await page.locator(".settings-back").click();
  const confirm = page.getByRole("dialog", { name: "GitHub 同步尚未完成" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "云端同步", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "云端同步", exact: true }),
  ).toBeVisible();
  await page.locator(".settings-back").click();
  await confirm.getByRole("button", { name: "仍然返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
});

test("反向长选区不会触发键盘光标补偿滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await fixture(page);
  const editor = page.locator(".ProseMirror");
  const before = await editor.evaluate((el) => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.view.focus();
    const root = el.closest(".note-editor-scroll")!;
    root.scrollTop = 800;
    document.documentElement.classList.add("web-keyboard-open");
    ed.commands.setTextSelection({
      from: ed.state.doc.content.size - 5,
      to: 2,
    });
    return root.scrollTop;
  });
  await page.waitForTimeout(200);
  expect(
    await page.locator(".note-editor-scroll").evaluate((el) => el.scrollTop),
  ).toBeCloseTo(before, 0);
  expect(
    await editor.evaluate(
      (el) =>
        (el as HTMLElement & { editor: Editor }).editor.state.selection.empty,
    ),
  ).toBe(false);
});

test("桌面工具栏对齐与按钮状态、固定标识和最近三批记录", async ({ page }) => {
  await fixture(page);
  const toolbar = page.locator(".note-editor .editor-menu");
  const geometry = await toolbar.evaluate((el) => {
    const button = el.querySelector("button")!;
    const lock = document.querySelector(
      ".note-title-row .note-readonly-badge",
    )!;
    return {
      left:
        button.getBoundingClientRect().left - lock.getBoundingClientRect().left,
      height: button.getBoundingClientRect().height,
      radius: getComputedStyle(button).borderRadius,
    };
  });
  expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1);
  expect(geometry.height).toBeGreaterThanOrEqual(28);
  expect(geometry.radius).toBe("4px");
  const bookmark = page.getByRole("button", { name: "文档书签", exact: true });
  await bookmark.click();
  await expect(bookmark).toHaveCSS("box-shadow", "none");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^更新记录/ }).click();
  await expect(page.locator(".settings-changelog-entry")).toHaveCount(3);
});

test("GitHub Pull 进行中也阻止直接返回", async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => {
    const p = "/src/lib/sync/github.ts";
    const { saveSyncConfig, loadSyncConfig } = await import(
      /* @vite-ignore */ performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((u) => new URL(u).pathname === p) ?? p
    );
    saveSyncConfig({
      ...loadSyncConfig(),
      owner: "test",
      repo: "test",
      token: "test-token",
    });
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) =>
      String(input).startsWith("https://api.github.com/")
        ? new Promise(() => {})
        : fetch(input, init);
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await page.getByRole("button", { name: /Pull/ }).first().click();
  await page.locator(".settings-back").click();
  const confirm = page.getByRole("dialog", { name: "GitHub 同步尚未完成" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "仍然返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
});
