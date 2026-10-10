import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

async function setup(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, {
      referenceGestureActive: false,
      copiedReference: null,
      referenceSaveFail: false,
    });
    document.addEventListener(
      "click",
      () => {
        (window as any).referenceGestureActive = true;
        setTimeout(() => {
          (window as any).referenceGestureActive = false;
        }, 0);
      },
      true,
    );
    class Item {
      constructor(private data: Record<string, Blob | Promise<Blob>>) {}
      getType(type: string) {
        return Promise.resolve(this.data[type]);
      }
    }
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: Item,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: Item[]) {
          if (!(window as any).referenceGestureActive)
            throw new Error("user gesture expired");
          const blob = await items[0].getType("text/plain");
          (window as any).copiedReference = await blob.text();
        },
        async writeText(text: string) {
          if (!(window as any).referenceGestureActive)
            throw new Error("user gesture expired");
          (window as any).copiedReference = text;
        },
      },
    });
    document.execCommand = () => false;
  });
  await createBlankDocument(page, "复制引用权限");
  await page.locator(".ProseMirror:visible").fill("prefix TARGET suffix");
  await waitForSavedText(page, "TARGET");
  await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const update = api.notes.update;
    api.notes.update = async (id: string, data: any) => {
      if (data.content?.metadata?.referenceAnchors?.length) {
        // Saving deliberately crosses an asynchronous task, like IndexedDB or IPC.
        await new Promise((resolve) => setTimeout(resolve, 80));
        if ((window as any).referenceSaveFail) throw new Error("save failed");
      }
      return update(id, data);
    };
  });
}
async function selectTarget(page: Page, range: boolean) {
  await page.locator(".ProseMirror:visible").evaluate((element, range) => {
    const ed = (element as HTMLElement & { editor: Editor }).editor;
    ed.commands.focus();
    ed.commands.setTextSelection(range ? { from: 8, to: 14 } : 8);
  }, range);
}
async function persistedAnchor(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content
      .metadata?.referenceAnchors?.[0];
  });
}
for (const width of [1280, 390])
  test(`工具栏复制块与位置引用在异步保存后仍可复制 ${width}`, async ({
    page,
  }) => {
    await setup(page);
    await closeDocumentSidebar(page);
    await page.setViewportSize({ width, height: 844 });
    for (const label of ["复制块引用", "复制此处引用", "复制选中文字引用"]) {
      await page.evaluate(() => {
        (window as any).copiedReference = null;
      });
      await selectTarget(page, label.includes("选中文字"));
      await page
        .getByRole("button", { name: "更多编辑操作", exact: true })
        .click();
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).copiedReference))
        .toMatch(/nr-note:\/\/.+#nr-ref-/);
      await expect(page.locator(".copy-block-feedback")).toContainText(
        "已复制引用",
      );
      expect(await persistedAnchor(page)).toBeTruthy();
      if (label.includes("选中文字"))
        expect(
          await page.evaluate(() => (window as any).copiedReference),
        ).toMatch(/^\[TARGET\]/);
    }
  });

test("右键复制与工具栏共用权限处理；保存失败不复制且恢复后可重试", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).referenceSaveFail = true;
  });
  await selectTarget(page, true);
  await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
  await page
    .getByRole("button", { name: "复制选中文字引用", exact: true })
    .click();
  await expect(page.locator(".copy-block-feedback")).toContainText(
    "复制引用失败",
  );
  expect(await page.evaluate(() => (window as any).copiedReference)).toBeNull();
  await page.evaluate(() => {
    (window as any).referenceSaveFail = false;
  });
  await page.getByRole("button", { name: "关闭错误详情", exact: true }).click();
  await selectTarget(page, true);
  await page.locator(".ProseMirror:visible").evaluate((element) => {
    const ed = (element as HTMLElement & { editor: Editor }).editor;
    const coords = ed.view.coordsAtPos(9);
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: coords.left,
        clientY: coords.top + 2,
      }),
    );
  });
  await page
    .locator(".editor-context-menu")
    .getByRole("button", { name: "复制选中文字引用", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copiedReference))
    .toMatch(/^\[TARGET\]/);
  await expect(page.locator(".copy-block-feedback")).toContainText(
    "已复制引用",
  );
  expect(await persistedAnchor(page)).toBeTruthy();
});

test("浏览器原生剪贴板在异步保存后写入引用", async ({ page, context, browserName }) => {
  // Headless Chromium needs clipboard-write permission for the native write
  // path. WebKit instead exercises its actual click-activation requirement.
  if (browserName === "chromium") await context.grantPermissions(["clipboard-write"]);
  await createBlankDocument(page, "原生引用复制");
  await page.locator(".ProseMirror:visible").fill("prefix TARGET suffix");
  await waitForSavedText(page, "TARGET");
  await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const update = api.notes.update;
    api.notes.update = async (id: string, data: any) => {
      if (data.content?.metadata?.referenceAnchors?.length)
        await new Promise((resolve) => setTimeout(resolve, 80));
      return update(id, data);
    };
    const write = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async (items) => {
      await write(items);
      (window as any).nativeReferenceCopied = true;
    };
  });
  await selectTarget(page, true);
  await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
  await page
    .getByRole("button", { name: "复制选中文字引用", exact: true })
    .click();
  await expect(page.locator(".copy-block-feedback")).toContainText(
    "已复制引用",
  );
  expect(await page.evaluate(() => (window as any).nativeReferenceCopied)).toBe(
    true,
  );
  expect(await persistedAnchor(page)).toBeTruthy();
});

test("局部只读工具栏复制块引用也保留点击权限", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("nr:experimentalReadonlyRendering", "true"),
  );
  await setup(page);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  const root = page.locator("[data-virtual-reader]");
  await expect(root).toBeVisible();
  await root.getByRole("button", { name: "复制块引用", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copiedReference))
    .toMatch(/nr-note:\/\/.+#nr-ref-/);
  expect(await persistedAnchor(page)).toBeTruthy();
});
