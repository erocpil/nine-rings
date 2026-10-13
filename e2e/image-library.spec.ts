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
      // The input reflects a request before the raster batch commits.
      // Wait for the actual second page before testing view preservation.
      await expect(reader.locator('.pdf-page-surface[data-pdf-page="2"] canvas')).toHaveAttribute("data-pdf-ready", "true");
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

async function openTwoPictures(page: import("@playwright/test").Page) {
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
  await panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  await expect
    .poll(() =>
      viewer
        .locator(".image-viewer-viewport img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  return { panel, viewer };
}

test("图片树切换与隐藏后保持展开和选中，方向键不依赖树的焦点", async ({
  page,
}) => {
  const { panel, viewer } = await openTwoPictures(page);
  const thumbnail = panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .locator("img");
  await expect(thumbnail).toBeVisible();
  const thumbnailSource = await thumbnail.getAttribute("src");
  await panel.evaluate((el) => {
    (el as HTMLElement).dataset.retainedImageTree = "yes";
  });
  await expect(
    panel.getByRole("button", { name: "icon-192.png", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator(".tiptap:visible")).toBeVisible();
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(panel).toHaveAttribute("data-retained-image-tree", "yes");
  await expect(thumbnail).toHaveAttribute("src", thumbnailSource!);
  await expect(
    panel.getByRole("button", { name: "icon-192.png", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await expect(
    panel.getByRole("button", { name: "ragdoll-32.png", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await panel.getByRole("button", { name: "收起图片分栏" }).click();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("heading")).toHaveText("icon-192.png");
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "icon-192.png", exact: true }),
  ).toHaveAttribute("aria-current", "true");
});

test("图片按钮与文档树切换视图，返回原视图仍可结束查看", async ({ page }) => {
  const { panel, viewer } = await openTwoPictures(page);
  await viewer.getByRole("button", { name: "下一张" }).click();
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator(".tiptap:visible")).toBeVisible();
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await viewer.getByRole("button", { name: "返回原视图" }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator(".tiptap:visible")).toBeVisible();
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(viewer).toBeHidden();
});

test("图片树名称连续点击和右键不选中文本，图片仍正常打开", async ({ page }) => {
  const { panel, viewer } = await openTwoPictures(page);
  const name = panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .locator("span")
    .last();
  await name.dblclick();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { mainViews } =
          await import("/src/lib/plugin-system/main-view-registry.ts");
        return mainViews.getSnapshot().pending;
      }),
    )
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
  await expect(viewer.getByRole("heading")).toHaveText("icon-192.png");
  await panel
    .getByRole("button", { name: "ragdoll-32.png", exact: true })
    .click();
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await panel
    .getByRole("button", { name: "ragdoll-32.png", exact: true })
    .locator("span")
    .last()
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "图片树菜单" });
  await expect(menu).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(viewer).toBeVisible();
  await name.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "查看图片", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(viewer.getByRole("heading")).toHaveText("icon-192.png");
  await name.click({ button: "right" });
  await viewer.getByRole("heading").click();
  await expect(menu).toBeHidden();
});

test("图片树菜单复制名称路径及目录收起，键盘不会切换图片", async ({ page }) => {
  const { panel, viewer } = await openTwoPictures(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.body.dataset.copiedImageText = text;
        },
      },
    });
  });
  const picture = panel.getByRole("button", {
    name: "icon-192.png",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "图片树菜单" });
  await picture.click({ button: "right" });
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "复制名称", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute(
    "data-copied-image-text",
    "icon-192.png",
  );
  await expect(menu).toBeHidden();
  await picture.click({ button: "right" });
  await menu
    .getByRole("menuitem", { name: "复制相对路径", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-copied-image-text",
    "icon-192.png",
  );
  await expect(viewer.getByRole("heading")).toHaveText("icon-192.png");
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click({ button: "right" });
  await menu.getByRole("menuitem", { name: "收起目录", exact: true }).click();
  await expect(picture).toBeHidden();
  await expect(viewer).toBeVisible();
});

test("图片与文档共享专注状态，切换和返回不会重置", async ({ page }) => {
  const { viewer } = await openTwoPictures(page);
  await viewer.getByRole("button", { name: "进入图片专注模式" }).click();
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await expect(page.locator(".note-editor:visible")).toHaveClass(/focus-mode/);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await viewer.getByRole("button", { name: "退出图片专注模式" }).click();
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await expect(page.locator(".note-editor:visible")).not.toHaveClass(
    /focus-mode/,
  );
  await page
    .locator(".note-editor:visible")
    .getByTitle("专注模式", { exact: true })
    .click();
  await page.getByRole("button", { name: "图片", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "退出图片专注模式" }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "返回原视图" }).click();
  await expect(page.locator(".note-editor:visible")).toHaveClass(/focus-mode/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nr:focusMode")))
    .toBe("true");
});

test("图片导航带、背景与非破坏变换可复位", async ({ page }) => {
  const { viewer } = await openTwoPictures(page);
  await expect(
    viewer.getByRole("navigation", { name: "图片缩略图导航" }),
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: "查看图片 ragdoll-32.png", exact: true })
    .click();
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await viewer.getByRole("button", { name: "水平翻转", exact: true }).click();
  await viewer.getByRole("button", { name: "旋转预览", exact: true }).click();
  const picture = viewer.locator(".image-viewer-viewport img");
  await expect(picture).toHaveAttribute(
    "style",
    /rotate\(90deg\) scale\(-1,\s*1\)/,
  );
  await viewer.getByLabel("图片查看背景").hover();
  await expect(page.locator(".quick-tooltip")).toHaveText("选择图片查看背景", { timeout: 1000 });
  await viewer.getByLabel("图片查看背景").selectOption("checker");
  await expect(viewer.locator(".image-viewer-viewport")).toHaveAttribute(
    "data-background",
    "checker",
  );
  await viewer.getByRole("button", { name: "复位预览", exact: true }).click();
  await expect(picture).toHaveAttribute(
    "style",
    /rotate\(0deg\) scale\(1,\s*1\)/,
  );
  await viewer.getByRole("button", { name: "缩略图", exact: true }).click();
  await expect(
    viewer.getByRole("navigation", { name: "图片缩略图导航" }),
  ).toBeHidden();
});

test("大图原始尺寸和适窗可切换，旋转后完整适窗", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 800;
    canvas.getContext("2d")!.fillRect(0, 0, 1600, 800);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  await panel.getByRole("button", { name: "wide.png", exact: true }).click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  const viewport = viewer.locator(".image-viewer-viewport");
  const picture = viewport.locator("img");
  await expect(picture).toBeVisible();
  await viewer.getByRole("button", { name: "原始尺寸", exact: true }).click();
  await expect
    .poll(() =>
      picture.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    )
    .toBe(1600);
  await viewer.getByRole("button", { name: "适窗", exact: true }).click();
  await viewer.getByRole("button", { name: "旋转预览", exact: true }).click();
  await expect
    .poll(async () => {
      const frame = (await viewport.boundingBox())!;
      const image = (await picture.boundingBox())!;
      return image.width <= frame.width + 1 && image.height <= frame.height + 1;
    })
    .toBe(true);
});

test("图片平移边界阻止继续外移，两轴均可返回", async ({ page }) => {
  const { viewer } = await openTwoPictures(page);
  const viewport = viewer.locator(".image-viewer-viewport");
  const picture = viewport.locator("img");
  await viewport.dispatchEvent("wheel", { deltaX: 100000, deltaY: 100000 });
  const edge = (await picture.boundingBox())!;
  await viewport.dispatchEvent("wheel", { deltaX: 100000, deltaY: 100000 });
  await expect.poll(() => picture.boundingBox()).toEqual(edge);
  const frame = (await viewport.boundingBox())!;
  expect(edge.x + edge.width).toBeGreaterThanOrEqual(frame.x + 23);
  expect(edge.y + edge.height).toBeGreaterThanOrEqual(frame.y + 23);
  await viewport.dispatchEvent("wheel", { deltaX: -50, deltaY: -50 });
  await expect
    .poll(async () => {
      const next = (await picture.boundingBox())!;
      return next.x > edge.x && next.y > edge.y;
    })
    .toBe(true);
});

test("缩略图带可滚动全部图片、支持双轴触控板且竖图不覆盖名称", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 128;
    canvas.getContext("2d")!.fillRect(0, 0, 24, 128);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles(
      Array.from({ length: 30 }, (_, index) => ({
        name: `${String(index).padStart(2, "0")}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      })),
    );
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  await panel.getByRole("button", { name: "00.png", exact: true }).click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  const strip = viewer.getByRole("navigation", { name: "图片缩略图导航" });
  const viewerBounds = (await viewer.boundingBox())!;
  await page.mouse.move(viewerBounds.x + 30, viewerBounds.y + viewerBounds.height - 3);
  await viewer.getByRole("button", { name: "固定缩略图", exact: true }).click();
  await expect(strip).toBeVisible();
  expect(await strip.getByRole("button").count()).toBeLessThan(30);
  await strip.dispatchEvent("wheel", { deltaX: 0, deltaY: 300 });
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const before = await strip.evaluate((el) => el.scrollLeft);
  await strip.dispatchEvent("wheel", { deltaX: 300, deltaY: 0 });
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(before);
  await strip.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const last = strip.getByRole("button", {
    name: "查看图片 29.png",
    exact: true,
  });
  await expect(last).toBeVisible();
  await expect(last.locator("img")).toBeVisible();
  const thumb = (await last.locator(".image-tree-thumbnail").boundingBox())!;
  const label = (await last.locator("span").last().boundingBox())!;
  expect(thumb.y + thumb.height).toBeLessThanOrEqual(label.y);
  await last.click();
  const picture = viewer.locator(".image-viewer-viewport img");
  await expect(picture).toBeVisible();
  const source = await picture.getAttribute("src");
  await viewer.getByRole("button", { name: "上一张图片", exact: true }).click();
  await expect(viewer.getByRole("heading")).toHaveText("28.png");
  await viewer.getByRole("button", { name: "下一张图片", exact: true }).click();
  await expect(picture).toHaveAttribute("src", source!);
});

test("原生 WebKit 捏合累计缩放，缩放锚定且不触发页面缩放", async ({ page }) => {
  const { viewer } = await openTwoPictures(page);
  const result = await viewer
    .locator(".image-viewer-viewport")
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [
        ["gesturestart", 1],
        ["gesturechange", 1.2],
        ["gesturechange", 1.5],
        ["gestureend", 1.5],
      ].map(([name, scale]) => {
        const event = new Event(String(name), {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperties(event, {
          scale: { value: scale },
          clientX: { value: bounds.left + bounds.width / 2 + 20 },
          clientY: { value: bounds.top + bounds.height / 2 + 20 },
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
  expect(result).toEqual([true, true, true, true]);
  await expect(viewer.getByRole("toolbar")).toContainText("150%");
  const picture = viewer.locator(".image-viewer-viewport img");
  await expect(picture).toHaveAttribute(
    "style",
    /translate\(-10px,\s*-10px\).*scale\(1.5\)/,
  );
  await viewer.locator(".image-viewer-viewport").evaluate((element) =>
    element.dispatchEvent(
      new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(viewer.getByRole("toolbar")).toContainText("150%"); // Do not apply a duplicate wheel stream.
});

test("图片专注模式保持查看器和分栏状态，属性可浮动和固定且切图后更新", async ({
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
  const { panel, viewer } = await openTwoPictures(page);
  const before = await viewer.boundingBox();
  await viewer.getByRole("button", { name: "进入图片专注模式" }).click();
  await expect(page.locator(".exhibition-masthead")).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(page.locator(".desktop-activity-bar")).toBeVisible();
  await expect(page.locator(".sidebar-divider")).toBeVisible();
  expect((await viewer.boundingBox())!.height).toBeGreaterThan(before!.height);
  await viewer.getByRole("button", { name: "图片属性", exact: true }).click();
  const properties = viewer.getByRole("region", {
    name: "图片属性",
    exact: true,
  });
  await expect(properties).toContainText("192 × 192");
  await expect(properties).toContainText("image/png");
  const propertyButton = viewer.getByRole("button", {
    name: "图片属性",
    exact: true,
  });
  const back = viewer.getByRole("button", { name: "返回原视图" });
  const focus = viewer.getByRole("button", { name: "退出图片专注模式" });
  expect((await propertyButton.boundingBox())!.x).toBeLessThan(
    (await back.boundingBox())!.x,
  );
  expect((await focus.boundingBox())!.x).toBeGreaterThan(
    (await back.boundingBox())!.x,
  );
  await properties
    .getByRole("button", { name: "固定图片属性", exact: true })
    .click();
  await expect(properties).toHaveClass(/is-pinned/);
  const area = await viewer.locator(".image-viewer-viewport").boundingBox();
  const props = await properties.boundingBox();
  expect(Math.abs(area!.x + area!.width - props!.x)).toBeLessThan(3);
  await viewer.getByRole("button", { name: "下一张图片" }).click();
  await expect(properties).toContainText("ragdoll-32.png");
  await expect(properties).toContainText("32 × 32");
  await panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .click();
  await expect(properties).toContainText("192 × 192");
  await expect(
    viewer.getByRole("button", { name: "退出图片专注模式" }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "退出图片专注模式" }).click();
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "icon-192.png", exact: true })
    .click();
  await expect(properties).toHaveClass(/is-pinned/);
  await expect(properties).toContainText("192 × 192");
  await properties.getByRole("button", { name: "取消固定图片属性" }).click();
  await expect(properties).not.toHaveClass(/is-pinned/);
  await properties.getByRole("button", { name: "关闭图片属性" }).click();
  await expect(properties).toHaveCount(0);
});

test("正文图片弹层支持专注与属性，Esc 依次关闭属性、退出专注和关闭查看器", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.locator(".ProseMirror:visible").evaluate((element: any) =>
    element.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "resizableImage",
          attrs: { src: "/icon-192.png", alt: "属性示例" },
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "查看图片", exact: true })
    .click({ force: true });
  const viewer = page.getByRole("dialog", { name: "图片查看器" });
  await viewer.getByRole("button", { name: "进入图片专注模式" }).click();
  await expect(viewer).toHaveClass(/image-viewer-focus/);
  await viewer.getByRole("button", { name: "图片属性", exact: true }).click();
  const props = viewer.getByRole("region", { name: "图片属性" });
  await expect(props).toContainText("192 × 192");
  await expect(props).toContainText("应用资源");
  await props
    .getByRole("button", { name: "固定图片属性", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(props).toHaveCount(0);
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).not.toHaveClass(/image-viewer-focus/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("竖图缩略图完整容纳，图片属性窄幅且可拖动调宽", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  const portrait = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 1000;
    canvas.getContext("2d")!.fillRect(0, 0, 100, 1000);
    return canvas.toDataURL().split(",")[1];
  });
  await panel.locator("input[type=file]").first().setInputFiles([
    { name: "portrait.png", mimeType: "image/png", buffer: Buffer.from(portrait, "base64") },
    { name: "second.png", mimeType: "image/png", buffer: Buffer.from(portrait, "base64") },
  ]);
  await panel.getByRole("button", { name: "已选择图片（临时）", exact: true }).click();
  const assertThumbnail = async (host: import("@playwright/test").Locator) => {
    await expect(host.locator("img")).toBeVisible();
    const geometry = await host.evaluate(element => {
      const box = element.getBoundingClientRect(); const img = element.querySelector("img")!; const picture = img.getBoundingClientRect();
      return { width: picture.width, height: picture.height, boxWidth: box.width, boxHeight: box.height, fit: getComputedStyle(img).objectFit, ratio: img.naturalWidth / img.naturalHeight };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.boxWidth);
    expect(geometry.height).toBeLessThanOrEqual(geometry.boxHeight);
    expect(geometry.fit).toBe("contain");
    expect(geometry.ratio).toBeCloseTo(0.1, 2);
  };
  await assertThumbnail(panel.locator(".image-tree-thumbnail").first());
  await panel.getByRole("button", { name: "portrait.png", exact: true }).click();
  const viewer = page.getByRole("region", { name: "图片查看器" });
  const dock = viewer.locator(".image-filmstrip-dock");
  const strip = viewer.locator(".image-viewer-filmstrip");
  const bounds = (await viewer.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
  await expect.poll(async () => (await strip.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1);
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1);
  await expect.poll(async () => (await viewer.getByRole("button", { name: "固定缩略图", exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1);
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height - 3);
  await expect.poll(async () => { const box = (await strip.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  await viewer.getByRole("button", { name: "固定缩略图", exact: true }).click();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
  await expect(dock).toHaveAttribute("data-pinned", "true");
  await assertThumbnail(strip.locator(".image-tree-thumbnail").first());
  const toolbarButtons = viewer.getByRole("toolbar").getByRole("button");
  for (const button of await toolbarButtons.all()) await expect(button.locator("svg")).toHaveCount(1);
  await expect(viewer.locator(".image-viewer-dimensions")).toHaveText("100 × 1000");
  await expect(viewer).not.toContainText("双击切换原始尺寸/适窗");
  await viewer.getByRole("button", { name: "图片属性", exact: true }).click();
  const properties = viewer.getByRole("region", { name: "图片属性" });
  expect((await properties.boundingBox())!.width).toBeLessThanOrEqual(262);
  await properties.getByRole("button", { name: "固定图片属性" }).click();
  const before = (await properties.boundingBox())!.width;
  const grip = await properties.getByRole("separator").boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + 30);
  await page.mouse.down(); await page.mouse.move(grip!.x - 60, grip!.y + 30); await page.mouse.up();
  await expect.poll(async () => (await properties.boundingBox())!.width).toBeGreaterThan(before + 40);
});
