import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

const markdown = Array.from(
  { length: 35 },
  (_, i) =>
    `# 第 ${i + 1} 章：长文档的阅读层级\n\n章节正文，包含多级标题、列表和代码。\n\n## 结构与留白\n\n- 第一项\n- 第二项\n\n> 一段补充说明\n\n\`\`\`text\nexample ${i}\n\`\`\`\n\n下一段正文。`,
).join("\n\n");

async function init(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const config = JSON.parse(
      localStorage.getItem("nine_rings_config") || "{}",
    );
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        ...config,
        interface_style: "calm",
        interface_color_mode: "light",
      }),
    );
  });
  await createBlankDocument(page);
}

test("长文档在编辑、源码和局部只读中随实际分栏宽度调整", async ({ page }) => {
  await init(page);
  await page.evaluate(async (markdown) => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "长文档排版",
      date: "2026-09-25",
      content: mdToDelta(markdown),
    });
    useNotesStore.getState().selectNote(note);
  }, markdown);
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(editor.locator("h1").first()).toHaveCSS("font-size", "34px");
  await expect(editor.locator("h2").first()).toHaveCSS("margin-top", "0px");
  await expect(editor.locator("p").first()).toHaveCSS("margin-bottom", "28px");
  const snapshot = await editor.evaluate((el) =>
    JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()),
  );
  await page
    .locator(".note-editor")
    .evaluate((el) =>
      Object.assign((el as HTMLElement).style, { maxWidth: "440px" }),
    );
  await expect(editor.locator("h1").first()).toHaveCSS("font-size", "27px");
  await expect(editor.locator("p").first()).toHaveCSS("font-size", "15px");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".markdown-cm-host")).toBeVisible();
  await page
    .locator(".markdown-source-content")
    .evaluate((el) =>
      Object.assign((el as HTMLElement).style, { maxWidth: "440px" }),
    );
  await expect(page.locator(".markdown-cm-host .cm-line").first()).toHaveCSS(
    "padding-left",
    "8px",
  );
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  expect(
    await editor.evaluate((el) =>
      JSON.stringify((el as HTMLElement & { editor: Editor }).editor.getJSON()),
    ),
  ).toBe(snapshot);
  await page.evaluate(async (markdown) => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const { setReadonlyRenderingEnabled } =
      await import("/src/lib/readonly-rendering.ts");
    setReadonlyRenderingEnabled(true);
    const note = await api.notes.create({
      title: "只读长文档排版",
      date: "2026-09-25",
      content: mdToDelta(markdown),
    });
    useNotesStore
      .getState()
      .selectNote(await api.notes.update(note.id, { readonly: true }));
  }, markdown);
  await expect(page.locator(".vr-body")).toBeVisible();
  await page
    .locator(".note-editor")
    .evaluate((el) =>
      Object.assign((el as HTMLElement).style, { maxWidth: "440px" }),
    );
  await expect(page.locator(".vr-block h1").first()).toHaveCSS(
    "font-size",
    "27px",
  );
  await expect(
    page.locator('.vr-row[data-next-heading="true"] p').first(),
  ).toHaveCSS("margin-bottom", "22px");
  await page.screenshot({
    path: "/tmp/nr-long-document-narrow.png",
    animations: "disabled",
  });
});

test("导航键盘操作、无结果反馈、对比度与减少动画", async ({ page }) => {
  await init(page);
  const title = page.locator(".doc-tree-open").first();
  await expect(title).toBeVisible();
  const name = await title.textContent();
  await title.focus();
  await title.press("Enter");
  await expect(page.locator(".note-title")).toHaveValue(name!);
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  const list = page.locator(".document-browser");
  await expect(list).toHaveAttribute("aria-busy", "false");
  await page
    .locator(".app-sidebar")
    .getByRole("button", { name: "搜索文档", exact: true })
    .click();
  await page
    .getByLabel("查找文档", { exact: true })
    .fill("不存在的文档_94382091");
  await expect(list.getByText("没有匹配的文档", { exact: true })).toBeVisible();
  await list.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(list.locator(".document-browser-open").first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".note-editor-scroll")).toHaveCSS(
    "scroll-behavior",
    "auto",
  );
  const contrast = await page.evaluate(() => {
    const el =
      document.querySelector(".document-browser-path") ||
      document.querySelector(".document-browser-count")!;
    const color = getComputedStyle(el).color;
    let ancestor: Element | null = el;
    let bg = "rgb(255, 255, 255)";
    while (ancestor) {
      const value = getComputedStyle(ancestor).backgroundColor;
      if (value !== "transparent" && value !== "rgba(0, 0, 0, 0)") {
        bg = value;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    const luminance = (rgb: string) =>
      rgb
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    const a = luminance(color),
      b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});
