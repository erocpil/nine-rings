import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("切换文档时保留各自的源码符号缓存", async ({ page }) => {
  await createBlankDocument(page, "符号缓存 A");
  const firstId = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const source = page.locator(".cm-content");
  await expect(source).toBeVisible();
  await replaceSource(source, "struct CachedType {\n  int cached_member;\n};\n");
  await page.getByRole("button", { name: "源码符号", exact: true }).click();
  const firstPanel = page.getByRole("navigation", { name: "源码符号", exact: true });
  await expect(firstPanel.getByText("cached_member: int", { exact: true })).toBeVisible();

  const secondId = await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const note = await api.notes.create({ title: "符号缓存 B", date: "2026-10-20", storagePath: "", docType: "note", content: { ops: [{ insert: "other document\n" }] } });
    return note.id;
  });
  const selectDocument = async (id: string) => page.evaluate(async documentId => {
    const { api } = await import(/* @vite-ignore */ "/src/lib/api.ts");
    const { useNotesStore } = await import(/* @vite-ignore */ "/src/stores/useNotesStore.ts");
    useNotesStore.getState().selectNote(await api.notes.get(documentId));
  }, id);
  await selectDocument(secondId);
  await expect(page.locator(".note-title")).toHaveValue("符号缓存 B");
  await page.waitForTimeout(180);
  await selectDocument(firstId!);
  await expect(page.locator(".note-title")).toHaveValue("符号缓存 A");
  await expect(page.getByRole("navigation", { name: "源码符号", exact: true }).getByText("cached_member: int", { exact: true })).toBeVisible({ timeout: 80 });
});

test("C/C++ 源码符号自动定位、支持排序并按源码偏移跳转", async ({ page }) => {
  await createBlankDocument(page, "本文件符号目录");
  const format = page.getByRole("combobox", { name: "文件格式", exact: true });
  await format.selectOption("c");
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  const source = `struct Packet {\n  int length;\n  void reset();\n};\n#define NR_PACKET_LIMIT 8\nstatic int packet_count;\n\nint zebra(void) { return 0; }\n\nint open_packet(int id) {\n  return id;\n}\n\nvoid alpha(void) { }\n`;
  await replaceSource(area, source);

  const symbolButton = page.getByRole("button", { name: "源码符号", exact: true }).first();
  await expect(symbolButton).toBeVisible();
  await symbolButton.click();
  const panel = page.getByRole("navigation", { name: "源码符号" });
  await expect(panel.locator(".document-outline-list")).toHaveCSS("padding-top", "4px");
  await expect(panel.locator(".document-outline-text").first()).toHaveCSS("font-size", "13px");
  await expect(panel.getByText("Packet", { exact: true })).toBeVisible();
  await expect(panel.getByText("length: int", { exact: true })).toBeVisible();
  const packetRow = panel.locator('.document-outline-item[data-symbol-kind="类型"]').filter({ hasText: "Packet" });
  const packetFold = packetRow.locator(".document-outline-fold");
  const memberRow = panel.locator('.document-outline-item[data-symbol-kind="成员"]').filter({ hasText: "length: int" });
  await expect(packetFold).toHaveCSS("width", "12px");
  await expect(packetRow.locator(".document-outline-level")).toHaveCSS("width", "14px");
  expect(await packetRow.evaluate(row => {
    const fold = row.querySelector(".document-outline-fold")!.getBoundingClientRect();
    const marker = row.querySelector(".document-outline-level")!.getBoundingClientRect();
    return marker.left - fold.right;
  })).toBeCloseTo(2, 1);
  await expect(memberRow.locator(".document-outline-level")).toHaveCSS("width", "14px");
  await expect(memberRow).toHaveAttribute("data-symbol-nested", "true");
  await expect(memberRow.locator(".document-outline-level")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -8, 0)");
  await expect(memberRow.locator(".document-outline-text")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -8, 0)");
  expect(await memberRow.locator(".document-outline-link").evaluate(link => getComputedStyle(link).gap)).toBe("3px");
  const functionMarker = panel.locator('.document-outline-item[data-symbol-kind="函数"] .document-outline-level').first();
  await expect(functionMarker).toHaveCSS("width", "14px");
  await expect(functionMarker).toHaveCSS("transform", "matrix(1, 0, 0, 1, -8, 0)");
  const macroRow = panel.locator('.document-outline-item[data-symbol-kind="宏"]').first();
  const macroMarker = macroRow.locator(".document-outline-level");
  await expect(macroMarker).toHaveCSS("width", "14px");
  await expect(macroMarker).toHaveCSS("transform", "none");
  const variableRow = panel.locator('.document-outline-item[data-symbol-kind="变量"]').filter({ hasText: "packet_count" });
  const functionRow = panel.locator('.document-outline-item[data-symbol-kind="函数"]').filter({ hasText: "zebra" });
  const topLevelRows = [packetRow, macroRow, variableRow, functionRow];
  const markerAndLabelPositions = await Promise.all(topLevelRows.map(row => row.evaluate(element => {
    const marker = element.querySelector(".document-outline-level")!.getBoundingClientRect();
    const label = element.querySelector(".document-outline-text")!.getBoundingClientRect();
    return { markerLeft: marker.left, labelLeft: label.left };
  })));
  expect(Math.max(...markerAndLabelPositions.map(position => position.markerLeft)) - Math.min(...markerAndLabelPositions.map(position => position.markerLeft))).toBeLessThan(0.5);
  expect(Math.max(...markerAndLabelPositions.map(position => position.labelLeft)) - Math.min(...markerAndLabelPositions.map(position => position.labelLeft))).toBeLessThan(0.5);
  for (const row of topLevelRows) {
    await expect(row.locator(".document-outline-level")).toHaveCSS("justify-content", "flex-start");
  }
  await expect(panel.locator(".document-outline-jumps")).toHaveCount(0);
  await expect(panel.locator(".document-outline-count")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "按字母顺序排序" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "固定源码符号" })).toBeVisible();
  const header = panel.locator(".document-outline-header");
  const actions = header.locator(".is-source-symbol-actions");
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS("justify-content", "flex-end");
  await expect(panel.locator('[aria-current="location"]')).toBeVisible();
  await expect(panel.locator(".document-outline-text").first()).toHaveCSS("white-space", "nowrap");
  const sourceOrder = await panel.locator(".document-outline-link").allTextContents();
  expect(sourceOrder.findIndex(text => text.includes("zebra"))).toBeLessThan(sourceOrder.findIndex(text => text.includes("alpha")));
  await panel.getByRole("button", { name: "按字母顺序排序" }).click();
  const alphabeticalOrder = await panel.locator(".document-outline-link").allTextContents();
  expect(alphabeticalOrder.findIndex(text => text.includes("alpha"))).toBeLessThan(alphabeticalOrder.findIndex(text => text.includes("zebra")));
  const sortButton = panel.getByRole("button", { name: "按源码出现顺序排序" });
  await expect(sortButton).toHaveAttribute("aria-pressed", "true");
  const alphabeticalBackground = await sortButton.evaluate(button => getComputedStyle(button).backgroundColor);
  await sortButton.click();
  const sourceOrderButton = panel.getByRole("button", { name: "按字母顺序排序" });
  await expect(sourceOrderButton).toHaveAttribute("aria-pressed", "false");
  const sourceOrderBackground = await sourceOrderButton.evaluate(button => getComputedStyle(button).backgroundColor);
  expect(alphabeticalBackground).not.toBe(sourceOrderBackground);

  await page.evaluate(() => {
    const key = "nr:workspaceLayout";
    const layout = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify({ ...layout, outlinePinned: true, panelsSide: "right" }));
    window.dispatchEvent(new Event("nr:workspace-layout-change"));
  });
  const dock = page.locator(".document-panel-dock.dock-right");
  await expect(dock).toBeVisible();
  const status = page.locator(".editor-status-bar");
  await status.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const statusGeometry = await status.evaluate(element => {
    const line = getComputedStyle(element, "::before");
    const rightInset = Number.parseFloat(line.right) || 0;
    const rect = element.getBoundingClientRect();
    const create = element.querySelector(".editor-status-create")!.getBoundingClientRect();
    return { createRight: create.right, lineRight: rect.right - rightInset };
  });
  expect(statusGeometry.createRight).toBeLessThanOrEqual(statusGeometry.lineRight + 0.5);
  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(statusGeometry.createRight).toBeLessThanOrEqual(dockBox!.x + 0.5);

  const functionEntry = panel.locator(".document-outline-link").filter({ hasText: "int open_packet(int id)" });
  await functionEntry.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.indexOf("open_packet"));
});

test("源码编辑区右键使用应用内菜单", async ({ page }) => {
  await createBlankDocument(page, "源码右键菜单");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeVisible({ timeout: 20000 });
  await replaceSource(area, "int value = 1;\n");
  await area.click({ button: "right", position: { x: 30, y: 12 } });
  const menu = page.getByRole("menu", { name: "源码编辑菜单" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "复制" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "全选" }).click();
  await expect.poll(async () => (await sourceInfo(area)).selectionEnd).toBe("int value = 1;\n".length);
  await area.click({ button: "right", position: { x: 30, y: 12 } });
  await expect(page.getByRole("menu", { name: "源码编辑菜单" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "源码编辑菜单" })).toHaveCount(0);
});
