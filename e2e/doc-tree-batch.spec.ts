import { expect, test, type Page } from "@playwright/test";

async function openDocumentView(page: Page) {
  await page.goto("/");
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "tree") await switcher.click();
}

async function createDocument(page: Page, title: string, path: string) {
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByPlaceholder("子路径 (如 nine-rings)").fill(path);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).last()).toBeVisible();
}

async function selectDocuments(page: Page, titles: string[]) {
  await page.getByTitle("批量选择").click();
  for (const title of titles) {
    await page.locator(".doc-tree-doc").filter({ hasText: title }).click();
  }
  await expect(page.locator(".doc-tree-checkbox:checked")).toHaveCount(titles.length);
}

async function seedViewportDocuments(page: Page, count = 36) {
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 10000 });
  await page.evaluate(async (documentCount) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("nine_rings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction("notes", "readwrite");
    const store = transaction.objectStore("notes");
    const timestamp = new Date().toISOString();
    for (let index = 0; index < documentCount; index += 1) {
      const title = `视口文档 ${String(index).padStart(2, "0")}`;
      store.put({
        id: `doc-tree-viewport-${String(index).padStart(3, "0")}`,
        date: "2026-08-31",
        title,
        content: { ops: [{ insert: `${title}\n` }] },
        tags: "[]",
        pinned: 0,
        readonly: 0,
        sort_order: 0,
        created_at: timestamp,
        updated_at: timestamp,
        storagePath: "projects/viewport-tests",
        docType: "reference",
        concepts: "[]",
        linkedDocIds: "[]",
        search_text: title,
      });
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    localStorage.setItem("nr:docTreeCollapsed", "[]");
    localStorage.setItem("nr:sidebarTab", "tree");
  }, count);
  await page.reload();
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "tree") await switcher.click();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "视口文档 35" })).toBeAttached();
}

test("文档树支持批量取消只读并移动到新目录", async ({ page }) => {
  await openDocumentView(page);
  const titles = ["批量文档甲", "批量文档乙"];
  await createDocument(page, titles[0], "batch-source");
  await createDocument(page, titles[1], "batch-source");

  await selectDocuments(page, titles);
  await page.getByTitle("批量设为只读").click();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-icon")).toHaveText("🔒");
  }

  await selectDocuments(page, titles);
  await page.getByTitle("批量取消只读").click();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-icon")).not.toHaveText("🔒");
  }

  await selectDocuments(page, titles);
  await page.getByTitle("批量移动").click();
  const dialog = page.getByRole("dialog", { name: "移动到" });
  await expect(dialog.getByText("已选择 2 篇", { exact: true })).toBeVisible();
  await dialog.getByPlaceholder("例如 archives/old").fill("new/batch-target");
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator(".doc-tree-folder .doc-tree-name").filter({ hasText: /^batch-target$/ })).toBeVisible();
  for (const title of titles) {
    await expect(page.locator(".doc-tree-doc").filter({ hasText: title })).toBeVisible();
  }
});

test("文档可从树顶部重命名且标题框修改会立即同步到树", async ({ page }) => {
  await openDocumentView(page);
  await createDocument(page, "重命名前", "rename-entry");

  await page.getByTitle("重命名当前文档").click();
  const renameInput = page.locator(".doc-tree-rename-input");
  await expect(renameInput).toBeFocused();
  await renameInput.fill("树上重命名");
  await renameInput.press("Enter");
  await expect(page.locator(".note-title")).toHaveValue("树上重命名");

  await page.locator(".note-title").fill("标题框同步");
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "标题框同步" })).toBeVisible();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "树上重命名" })).toHaveCount(0);

  await page.waitForTimeout(700);
  await page.reload();
  const switcher = page.locator(".sidebar-view-switch");
  if (await switcher.getAttribute("data-target-view") === "tree") await switcher.click();
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "标题框同步" })).toBeVisible();
});

test("文档树长名称提供完整文本提示", async ({ page }) => {
  await openDocumentView(page);
  const title = "这是一个用于验证文档树在名称超过侧栏宽度时仍能通过提示查看全部内容的很长文档名称";
  await createDocument(page, title, "tooltip-entry");

  const name = page.locator(".doc-tree-doc").filter({ hasText: title }).locator(".doc-tree-name");
  await expect(name).toHaveAttribute("title", title);
  await expect.poll(() => name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test("文档树点击可见项不强制居中且底部右键菜单不越出视口", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await openDocumentView(page);
  await seedViewportDocuments(page);

  const tree = page.locator(".doc-tree");
  const target = page.locator(".doc-tree-doc").filter({ hasText: "视口文档 20" });
  await expect(target).toBeAttached();
  const initial = await target.evaluate((element) => {
    const root = element.closest<HTMLElement>(".doc-tree")!;
    const rootRect = root.getBoundingClientRect();
    root.scrollTop += element.getBoundingClientRect().top - rootRect.top - 12;
    return { scrollTop: root.scrollTop, clientHeight: root.clientHeight };
  });
  expect(initial.scrollTop).toBeGreaterThan(0);
  expect(initial.clientHeight).toBeGreaterThan(80);
  await expect(target).toBeVisible();

  await target.click();
  await expect(target).toHaveClass(/doc-tree-selected/);
  await expect.poll(async () => Math.abs(
    await tree.evaluate((element) => element.scrollTop) - initial.scrollTop,
  )).toBeLessThanOrEqual(1);

  await tree.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastDocument = page.locator(".doc-tree-doc").filter({ hasText: "视口文档 35" });
  await expect(lastDocument).toBeVisible();
  const viewport = page.viewportSize()!;
  const triggerBox = (await lastDocument.boundingBox())!;
  await lastDocument.click({ button: "right" });

  const menu = page.locator(".doc-context-menu");
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const box = await menu.boundingBox();
    return Boolean(box
      && box.x >= 0
      && box.y >= 0
      && box.x + box.width <= viewport.width
      && box.y + box.height <= viewport.height);
  }).toBe(true);
  const menuBox = (await menu.boundingBox())!;
  // Playwright 默认在目标中心右键；若仍直接使用原始 clientY，菜单必然越过底边。
  expect(triggerBox.y + triggerBox.height / 2 + menuBox.height).toBeGreaterThan(viewport.height);
  await expect(menu).toHaveCSS("overflow-y", "auto");
});

test("目录汇总为同名文档显示相对子路径", async ({ page }) => {
  await openDocumentView(page);
  await createDocument(page, "同名文档.txt", "moc-root/b");
  await createDocument(page, "同名文档.txt", "moc-root/c");

  await page.locator(".doc-tree-folder .doc-tree-name").getByText("moc-root", { exact: true }).click();
  const moc = page.locator(".moc");
  await expect(moc.locator(".moc-title-text", { hasText: "同名文档.txt" })).toHaveCount(2);
  await expect(moc.locator(".moc-title-path", { hasText: /^b$/ })).toBeVisible();
  await expect(moc.locator(".moc-title-path", { hasText: /^c$/ })).toBeVisible();
});
