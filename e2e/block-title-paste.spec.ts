import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function fixture(page: Page, virtual = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async (virtual) => {
    const load = (path: string) =>
      import(
        /* @vite-ignore */ performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((url) => new URL(url).pathname === path) ?? path
      );
    const { api } = await load("/src/lib/api.ts");
    const { mdToDelta } = await load("/src/lib/md-parser.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const { setReadonlyRenderingEnabled } = await load(
      "/src/lib/readonly-rendering.ts",
    );
    setReadonlyRenderingEnabled(virtual);
    const note = await api.notes.create({
      title: "块标题与折叠回归",
      storagePath: "tests",
      date: useNotesStore.getState().currentDate,
      content: mdToDelta(
        "```js\nconst original = 42;\n```\n\n> 引用原文\n\n末尾",
      ),
    });
    useNotesStore.getState().selectNote(note);
  }, virtual);
  await expect(page.locator(".note-title")).toHaveValue("块标题与折叠回归");
  await expect(page.locator(".ProseMirror pre code")).toHaveText(
    "const original = 42;",
  );
}

for (const width of [390, 1280]) {
  test(`代码简介原生粘贴保留选区，正文和引用粘贴仍正常 ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page);
    // Fill the real clipboard through a native input, including Markdown-like text.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "clipboard-fixture";
      input.value = "**简介粘贴**";
      document.body.appendChild(input);
      input.select();
    });
    await page.keyboard.press("ControlOrMeta+c");
    await page
      .locator("#clipboard-fixture")
      .evaluate((element) => element.remove());
    await page.locator(".ProseMirror pre code").click();
    const title = page.getByRole("textbox", { name: "代码简介", exact: true });
    await title.fill("前后");
    await title.evaluate((element) =>
      (element as HTMLInputElement).setSelectionRange(1, 1),
    );
    await title.press("ControlOrMeta+v");
    await expect(title).toHaveValue("前**简介粘贴**后");
    await expect(title).toBeFocused();
    await expect(page.locator(".ProseMirror pre code")).toHaveText(
      "const original = 42;",
    );

    for (const target of [".code-block-title", ".note-title"]) {
      const allowed = await page.locator(target).evaluate((element) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "https://example.com/title");
        clipboardData.setData("text/html", "<b>标题</b>");
        return element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData,
          }),
        );
      });
      expect(allowed).toBe(true);
    }
    await expect(page.locator(".ProseMirror pre code")).toHaveText(
      "const original = 42;",
    );
    await page.locator(".blockquote-content p").click();
    await page.locator(".blockquote-content p").evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "引用粘贴");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    });
    await expect(page.locator(".blockquote-content")).toContainText("引用粘贴");
    await page.locator(".ProseMirror pre code").click();
    await page.locator(".ProseMirror pre code").evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "\n# literal code");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    });
    await expect(page.locator(".ProseMirror pre code")).toContainText(
      "# literal code",
    );
  });

  for (const virtual of [false, true]) {
    test(`折叠后立即切换只读保留代码和引用状态 ${width} virtual=${virtual}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await fixture(page, virtual);
      await page.evaluate(() => {
        const state = {
          expanded: false,
          observer: new MutationObserver(() => {
            const block = document.querySelector(
              ".vr-note .code-block-wrap, .note-editor-readonly .code-block-wrap",
            );
            if (block && !block.classList.contains("collapsed"))
              state.expanded = true;
          }),
        };
        state.observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class"],
        });
        Object.assign(window, { blockFoldProbe: state });
      });
      // Trigger the readonly switch in the same task, before autosave's debounce.
      await page.locator(".ProseMirror").evaluate((element) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor;
        const tr = editor.state.tr;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "codeBlock" || node.type.name === "blockquote")
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              collapsed: true,
            });
        });
        editor.view.dispatch(tr);
        document
          .querySelector<HTMLButtonElement>('[aria-label="点击设为只读"]')!
          .click();
      });
      await expect(
        page.locator(virtual ? ".vr-note" : ".note-editor-readonly"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "展开代码块", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "展开引用块", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => {
          const state = (
            window as Window & {
              blockFoldProbe: { expanded: boolean; observer: MutationObserver };
            }
          ).blockFoldProbe;
          state.observer.disconnect();
          return state.expanded;
        }),
      ).toBe(false);
      const saved = await page.evaluate(async () => {
        const path = "/src/lib/api.ts";
        const { api } = await import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
        const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
        return note.content.ops.some(
          (op: { attributes?: Record<string, unknown> }) =>
            op.attributes?.["code-collapsed"] === true,
        );
      });
      expect(saved).toBe(true);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "展开代码块", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "展开引用块", exact: true }),
      ).toBeVisible();
    });
  }
}
