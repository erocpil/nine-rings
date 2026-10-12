import { createPdfFixture, createEpubFixture } from "./helpers/reader-fixtures";
import { test, expect } from "./helpers/reader-test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";
async function enable(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toBeVisible();
}
test("图片分栏浏览文件、查看缩放旋转、插入文档及撤销，停用撤销分栏", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles(["public/icon-192.png", "public/ragdoll-32.png"]);
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  await panel.getByRole("button", { name: "icon-192.png" }).click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  const picture = viewer.locator(".image-viewer-viewport img");
  await expect(picture).toBeVisible();
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await viewer.getByRole("button", { name: "放大图片" }).click();
  await expect(viewer.getByRole("toolbar")).toContainText("125%");
  await viewer.getByRole("button", { name: "旋转预览" }).click();
  await expect(picture).toHaveAttribute("style", /rotate\(90deg\)/);
  await viewer.getByRole("button", { name: "下一张图片" }).click();
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await viewer.getByRole("button", { name: "插入当前文档" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.getByLabel("内置插件结果", { exact: true })).toContainText(
    "图片已插入并保存",
  );
  const editor = page.locator(".ProseMirror:visible");
  await expect(editor.locator('img[alt="ragdoll-32.png"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator('img[alt="ragdoll-32.png"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { saveImageViewerEnabled } =
      await import("/src/lib/plugin-system/builtin-image-viewer.ts");
    saveImageViewerEnabled(false);
  });
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toHaveCount(0);
  await expect(panel).toHaveCount(0);
});
test("文档图片可查看，按真实文档切换图片，关闭恢复焦点", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.locator(".ProseMirror:visible").evaluate((element: any) =>
    element.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "resizableImage",
          attrs: { src: "/icon-192.png", alt: "第一张" },
        },
        {
          type: "resizableImage",
          attrs: { src: "/ragdoll-32.png", alt: "第二张" },
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "查看图片", exact: true })
    .first()
    .click({ force: true });
  const viewer = page.getByRole("dialog", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("第一张");
  await viewer.getByRole("button", { name: "下一张图片" }).click();
  await expect(viewer.getByRole("heading")).toHaveText("第二张");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
test("手机从文档树进入图片分栏，撤销授权不会删除选择文件", async ({ page }) => {
  await createBlankDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  // Open the existing document drawer, then select its image entry.
  await openDocumentSidebar(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await expect(panel).toBeVisible();
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/icon-192.png");
  await panel.getByRole("button", { name: /移除图片目录/ }).click();
  await expect(panel).toContainText("还没有图片目录");
  await panel.getByRole("button", { name: "返回文档树" }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toBeVisible();
});

async function openSelectedFile(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/icon-192.png");
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .click();
  return page.getByRole("region", { name: "图片查看器" });
}

for (const source of [false, true]) {
  test(`主区域图片保留文档实例、位置及撤销历史，源码=${source}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await enable(page);
    if (source)
      await page.getByTitle("切换到 Markdown 源码", { exact: true }).click();
    const editor = page.locator(
      source ? ".cm-content:visible" : ".ProseMirror:visible",
    );
    await editor.click();
    await page.keyboard.type("retain this edit");
    const node = await editor.elementHandle();
    const viewer = await openSelectedFile(page);
    await expect(viewer).toBeVisible();
    await expect(page.getByRole("dialog", { name: "图片查看器" })).toHaveCount(
      0,
    );
    await expect(editor).toHaveCount(0);
    await expect(viewer.locator(".image-viewer-viewport img")).toBeVisible();
    // Image tree remains interactive instead of being blocked by a modal.
    await expect(
      page.getByRole("region", { name: "图片目录分栏" }),
    ).toBeVisible();
    await viewer.getByRole("button", { name: "返回原视图" }).click();
    await expect(editor).toContainText("retain this edit");
    expect(
      await editor.evaluate((element, previous) => element === previous, node),
    ).toBe(true);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toContainText("retain this edit");
  });
}

test("正文图片弹层可转到主区域，停用恢复原文档", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.locator(".ProseMirror:visible").evaluate((element: any) =>
    element.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "resizableImage",
          attrs: { src: "/icon-192.png", alt: "示例图片" },
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "查看图片", exact: true })
    .click({ force: true });
  const modal = page.getByRole("dialog", { name: "图片查看器" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "在主区域打开" }).click();
  await expect(modal).toHaveCount(0);
  const main = page.getByRole("region", { name: "图片查看器" });
  await expect(main).toBeVisible();
  await expect(main.getByRole("heading")).toHaveText("示例图片");
  await page.evaluate(async () => {
    const { saveImageViewerEnabled } =
      await import("/src/lib/plugin-system/builtin-image-viewer.ts");
    saveImageViewerEnabled(false);
  });
  await expect(main).toHaveCount(0);
  await expect(page.locator(".ProseMirror:visible img")).toBeVisible();
});

test("主区域图片首页往返保留查看状态，首页打开图片后返回仍显示图片", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        workspace_layout: "exhibition",
        interface_style: "calm",
      }),
    ),
  );
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  const viewer = await openSelectedFile(page);
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "放大图片" }).click();
  await page
    .getByRole("button", { name: "返回工作区首页", exact: true })
    .click();
  await expect(viewer).toBeHidden();
  await expect(page.locator(".exhibition-welcome")).toBeVisible();
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("toolbar")).toContainText("125%");
  await viewer.getByRole("button", { name: "返回原视图" }).click();
  await page
    .getByRole("button", { name: "返回工作区首页", exact: true })
    .click();
  // Reuse the same registered source while on home.
  await page.evaluate(async () => {
    const { imageDirectoryService } =
      await import("/src/lib/image-library/directory-service.ts");
    const { requestMainImageView } =
      await import("/src/lib/image-library/viewer-request.ts");
    const root = (await imageDirectoryService.roots())[0];
    requestMainImageView({
      src: "",
      name: "首页图片",
      rootId: root.id,
      nodeId: "icon-192.png",
    });
  });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("首页图片");
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("首页图片");
});

test("保存失败不允许图片视图覆盖未保存的文档", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    const id = localStorage.getItem("nr:lastNote");
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "notes" && value.id === id)
        throw new DOMException("image-view-save-test", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await page.locator(".ProseMirror:visible").click();
  await page.keyboard.type("keep unsaved edit");
  const viewer = await openSelectedFile(page);
  await expect(
    page.getByRole("button", { name: "查看保存错误详情", exact: true }),
  ).toBeVisible();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator(".ProseMirror:visible")).toContainText(
    "keep unsaved edit",
  );
});

test("手机从图片树打开主区域自动收回抽屉，返回保留文档", async ({ page }) => {
  await createBlankDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  await openDocumentSidebar(page);
  const viewer = await openSelectedFile(page);
  await expect(viewer).toBeVisible();
  await expect(page.getByRole("region", { name: "图片目录分栏" })).toBeHidden();
  const bounds = await viewer.boundingBox();
  expect(bounds!.width).toBeGreaterThan(320);
  await viewer.getByRole("button", { name: "返回原视图" }).click();
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
});

test("只读文档图片可在主区域查看但不允许插入，文档导航取代插件视图", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "点击设为可编辑", exact: true }),
  ).toBeVisible();
  const viewer = await openSelectedFile(page);
  await expect(viewer).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "插入当前文档" }),
  ).toBeDisabled();
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "另一个文档",
      date: "2026-10-12",
      storagePath: "ideas",
      docType: "note",
      content: { ops: [{ insert: "navigation content\n" }] },
    });
    useNotesStore.getState().selectNote(note);
  });
  await expect(viewer).toHaveCount(0);
  await expect(page.locator(".note-title")).toHaveValue("另一个文档");
});

test("主区域返回恢复原文档的滚动位置与光标", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/icon-192.png");
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate((element: any) => {
    const instance = element.editor;
    instance.commands.setContent(
      {
        type: "doc",
        content: Array.from({ length: 90 }, (_, i) => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `paragraph ${i} content for retained position`,
            },
          ],
        })),
      },
      true,
    );
    instance.commands.setTextSelection(1200);
    element.closest(".note-editor-scroll").scrollTop = 700;
  });
  const scroll = page.locator(".note-editor-scroll:visible");
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(500);
  const before = await editor.evaluate((element: any) => ({
    from: element.editor.state.selection.from,
    to: element.editor.state.selection.to,
    top: element.closest(".note-editor-scroll").scrollTop,
  }));
  await panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect
    .poll(() =>
      editor.evaluate((element: any) => ({
        from: element.editor.state.selection.from,
        to: element.editor.state.selection.to,
      })),
    )
    .toEqual({ from: before.from, to: before.to });
  await expect
    .poll(() =>
      scroll.evaluate(
        (element, top) => Math.abs(element.scrollTop - top),
        before.top,
      ),
    )
    .toBeLessThan(4);
});

for (const format of ["pdf", "epub"] as const) {
  test(`图片主区域返回保留 ${format} 阅读器实例及阅读位置`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          workspace_layout: "exhibition",
          interface_style: "calm",
        }),
      ),
    );
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await enable(page);
    await page
      .getByRole("button", { name: "返回工作区首页", exact: true })
      .click();
    await page.mouse.move(5, 220);
    await page
      .getByRole("button", { name: "PDF / EPUB 阅读", exact: true })
      .click();
    const library = page.getByRole("region", {
      name: "阅读资料库",
      exact: true,
    });
    await library
      .locator(
        format === "pdf"
          ? 'input[accept="application/pdf,.pdf"]'
          : 'input[accept="application/epub+zip,.epub"]',
      )
      .setInputFiles({
        name: `preserve-reader.${format}`,
        mimeType: format === "pdf" ? "application/pdf" : "application/epub+zip",
        buffer: format === "pdf" ? createPdfFixture() : createEpubFixture(),
      });
    const reader = page.getByLabel(
      format === "pdf" ? "PDF 阅读器" : "EPUB 阅读器",
      { exact: true },
    );
    await expect(reader).toBeVisible();
    if (format === "pdf") {
      await page.getByLabel("PDF 页码", { exact: true }).fill("2");
      await page.getByLabel("PDF 页码", { exact: true }).press("Enter");
      await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue(
        "2",
      );
    } else {
      await expect(
        page
          .locator(".epub-chapter-frame")
          .contentFrame()
          .getByRole("heading", { name: "第一章" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "下一章", exact: true }).click();
      await expect(
        page
          .locator(".epub-chapter-frame")
          .contentFrame()
          .getByRole("heading", { name: "第二章" }),
      ).toBeVisible();
    }
    const original = await reader.elementHandle();
    await page.evaluate(async () => {
      const { requestMainImageView } =
        await import("/src/lib/image-library/viewer-request.ts");
      requestMainImageView({ src: "/icon-192.png", name: "阅读器图片" });
    });
    const viewer = page.getByRole("region", { name: "图片查看器" });
    await expect(viewer).toBeVisible();
    await expect(reader).toBeHidden();
    await viewer.getByRole("button", { name: "返回原视图" }).click();
    await expect(reader).toBeVisible();
    expect(
      await reader.evaluate(
        (element, previous) => element === previous,
        original,
      ),
    ).toBe(true);
    if (format === "pdf")
      await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue(
        "2",
      );
    else
      await expect(
        page
          .locator(".epub-chapter-frame")
          .contentFrame()
          .getByRole("heading", { name: "第二章" }),
      ).toBeVisible();
  });
}
