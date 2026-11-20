import { expect, type Locator, type Page } from "@playwright/test";

export function measureDocumentRail(scope: Locator, source: boolean) {
  return scope.evaluate((root, source) => {
    const visible = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)]
      .find(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    const body = visible(source ? ".cm-scroller" : ".editor-content-shell, .vr-body");
    const scroll = source ? body : visible(".note-editor-scroll");
    if (!body || !scroll) return { left: 0, width: 0, title: false, toolbar: false, status: false, maxDifference: Infinity, scrollbar: 0, docked: false, titleWidth: 0 };
    const bounds = body.getBoundingClientRect();
    const preview = source ? visible(".markdown-preview-scroll") : null;
    const split = preview?.closest(".markdown-split-preview");
    const inset = parseFloat(getComputedStyle(body).getPropertyValue("--document-edge-inset"));
    const left = split ? split.getBoundingClientRect().left + inset : bounds.left + (source ? body.clientLeft : 0);
    const width = preview ? preview.getBoundingClientRect().left + preview.clientLeft + preview.clientWidth - inset - left : source ? body.clientWidth : bounds.width;
    const line = (element?: HTMLElement) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const background = style.backgroundSize.split(",").at(-1)!.trim();
      const position = style.backgroundPositionX.split(",").at(-1)!;
      const offset = position.match(/(-?[\d.]+)px/)?.[1];
      const inset = background.match(/^calc\(100% - ([\d.]+)px\) 1px$/)?.[1];
      const width = inset === undefined ? parseFloat(background) : element.clientWidth - Number(inset);
      if (!style.backgroundImage.includes("linear-gradient") || offset === undefined || (inset === undefined && !background.endsWith("px 1px")) || !Number.isFinite(width)) return null;
      return { left: element.getBoundingClientRect().left + Number(offset), width };
    };
    const toolbar = visible(".document-toolbar, .vr-actions");
    const titleElement = visible(".document-title-bar, .vr-title");
    const title = line(titleElement);
    const dock = visible(".document-panel-dock");
    const dockWorkspace = dock?.closest(".note-editor")?.getBoundingClientRect();
    const titleBounds = titleElement?.getBoundingClientRect();
    const status = line(visible(".editor-status-bar"));
    const toolbarLine = toolbar?.matches(".vr-actions") ? line(toolbar) : toolbar?.getBoundingClientRect();
    const differences = [toolbarLine, status].flatMap(item => item ? [Math.abs(item.left - left), Math.abs(item.width - width)] : []);
    if (title && dock && dockWorkspace && titleBounds) {
      differences.push(
        Math.abs(title.left - dockWorkspace.left - inset),
        Math.abs(title.left + title.width - dockWorkspace.right + inset),
        Math.abs(titleBounds.bottom - dock.getBoundingClientRect().top),
      );
    } else if (title) {
      differences.push(Math.abs(title.left - left), Math.abs(title.width - width));
    }
    return { left, width, title: !!title, toolbar: !!toolbar, status: !!status, maxDifference: Math.max(0, ...differences), scrollbar: scroll.offsetWidth - scroll.clientWidth, docked: Boolean(dock), titleWidth: title?.width ?? 0 };
  }, source);
}

export async function createBlankDocument(page: Page, title = "折叠回归") {
  await page.goto("/");
  await createDocumentInWorkspace(page, title);
}

/** Create without navigation so installed failure hooks and current sessions survive. */
export async function createDocumentInWorkspace(
  page: Page,
  title = "折叠回归",
) {
  // Read-only virtual documents contain many ProseMirror blocks.
  await expect(page.locator(".note-editor")).toBeVisible();
  const previousNoteId = await page.evaluate(() =>
    localStorage.getItem("nr:lastNote"),
  );
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote")))
    .not.toBe(previousNoteId);
  await expect(page.locator(".ProseMirror")).toHaveText("");
}

/** Check persisted content, not a saved badge left over from the previous edit. */
export async function waitForSavedText(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/lib/api.ts";
        const { api } = await import(/* @vite-ignore */ path);
        const id = localStorage.getItem("nr:lastNote");
        if (!id) return null;
        const note = await api.notes.get(id);
        return note?.content?.ops
          ?.map((op: { insert?: unknown }) =>
            typeof op.insert === "string" ? op.insert : "",
          )
          .join("");
      }),
    )
    .toContain(text);
}
