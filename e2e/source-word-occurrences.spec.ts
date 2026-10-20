import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("源码点击高亮全词匹配，Ctrl/Command+单击打开可跳转的匹配面板", async ({ page }) => {
  await createBlankDocument(page, "源码全词匹配");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeVisible({ timeout: 20000 });
  const source = "int packet_count = 0;\nint packet_counted = packet_count + packet_count;\nvoid use_packet_count(void) { packet_count++; }\n";
  await replaceSource(area, source);

  const word = "packet_count";
  const clickWord = async (offset: number, modifiers: ("Control" | "Meta")[] = []) => {
    const point = await area.evaluate(async (element, at) => {
      const { EditorView } = (window as any).sourceCM;
      const view = EditorView.findFromDOM(element)!;
      const coords = view.coordsAtPos(at)!;
      return { x: coords.left + 2, y: (coords.top + coords.bottom) / 2 };
    }, offset);
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.mouse.click(point.x, point.y);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  };

  await clickWord(source.indexOf(word) + 2);
  await expect.poll(() => area.locator(".cm-source-word-match").count()).toBe(4);
  await expect(area.locator(".cm-source-word-match-active")).toHaveCount(1);
  await clickWord(source.indexOf("=") + 1);
  await expect(area.locator(".cm-source-word-match")).toHaveCount(0);
  await expect(area.locator(".cm-source-word-match-active")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "同词匹配", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "同词匹配", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("同词匹配：显示或隐藏匹配列表");

  await page.getByRole("button", { name: "源码符号", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "源码符号", exact: true })).toBeVisible();
  await clickWord(source.lastIndexOf(word) + 2, ["Control", "Meta"]);
  const panel = page.getByRole("navigation", { name: "同词匹配列表", exact: true });
  await expect(panel).toBeVisible();
  await expect(area.locator(".cm-source-word-match")).toHaveCount(4);
  await clickWord(source.indexOf("=") + 1);
  await expect(area.locator(".cm-source-word-match")).toHaveCount(0);
  await expect(panel.locator(".document-source-match-row")).toHaveCount(3);
  await expect(panel.locator(".document-source-matches-header")).toContainText("packet_count");
  const dock = page.getByRole("complementary", { name: "固定阅读面板" });
  await expect(dock.locator(".document-panel-slot[data-panel='outline']")).toBeVisible();
  await expect(dock.locator(".document-panel-matches-slot")).toBeVisible();
  const heightDivider = page.getByRole("separator", { name: "调整匹配列表高度" });
  await expect(heightDivider).toHaveAttribute("aria-valuenow", "33");
  const separatorBox = (await heightDivider.boundingBox())!;
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + separatorBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y - 45, { steps: 6 });
  await page.mouse.up();
  const draggedRatio = Number(await heightDivider.getAttribute("aria-valuenow"));
  expect(draggedRatio).toBeGreaterThan(33);
  await expect.poll(() => page.evaluate(() => Math.round(JSON.parse(localStorage.getItem("nr:workspaceLayout")!).matchesRatio * 100))).toBe(draggedRatio);
  await heightDivider.press("ArrowUp");
  await expect(heightDivider).toHaveAttribute("aria-valuenow", String(draggedRatio + 5));
  expect(await dock.locator(":scope > .document-panel-dock-main").evaluate(main => main.compareDocumentPosition(main.nextElementSibling!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(panel.locator(".document-source-match-row")).toHaveCount(3);
  expect(await panel.locator(".document-source-match-row").first().evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" ")[0])).toBe("34px");
  await expect(panel.locator(".document-source-match-row").nth(1).locator(".document-source-match-line")).toHaveCSS("font-weight", "700");
  expect(await panel.locator(".document-source-match-row").first().evaluate(row => {
    const line = row.querySelector(".document-source-match-line")!.getBoundingClientRect();
    const text = row.querySelector("code")!.getBoundingClientRect();
    return Math.abs(line.top - text.top);
  })).toBeLessThanOrEqual(1);
  expect(await panel.locator(".document-source-match-line").allTextContents()).toEqual(["1", "2", "3"]);
  await panel.locator(".document-source-match-row").last().click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.lastIndexOf(word));
  await expect.poll(async () => (await sourceInfo(area)).selectionEnd).toBe(source.lastIndexOf(word) + word.length);
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  const emptyBookmark = dock.locator(".document-panel-slot[data-panel='bookmark']");
  await expect.poll(() => emptyBookmark.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(65);
  await expect(emptyBookmark.locator(".document-bookmark-list")).toHaveCount(0);
  await page.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
  await expect.poll(() => emptyBookmark.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(65);
  const split = page.getByRole("separator", { name: "调整目录与书签比例" });
  await expect(split).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    const box = (await split.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 3);
    await expect.poll(async () => (await split.boundingBox())!.y).toBeGreaterThanOrEqual(box.y);
    await page.mouse.move(x, y + 16, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await split.boundingBox())!.y).toBeGreaterThan(box.y + 10);
  }
  const headers = await dock.evaluate(element => {
    const outline = element.querySelector<HTMLElement>('.document-panel-slot[data-panel="outline"] .document-outline-header')!;
    const bookmark = element.querySelector<HTMLElement>('.document-panel-slot[data-panel="bookmark"] .document-bookmark-header')!;
    const matches = element.querySelector<HTMLElement>('.document-source-matches-header')!;
    return [outline, bookmark, matches].map(header => ({
      height: header.getBoundingClientRect().height,
      rule: getComputedStyle(header).backgroundSize,
      border: getComputedStyle(header).borderBottomColor,
    }));
  });
  expect(headers[2]).toEqual(headers[0]);
  expect(headers[2]).toEqual(headers[1]);
  await expect(dock.locator(".document-panel-matches-slot")).toHaveCSS("border-top-width", "0px");
  await page.mouse.move(5, 5);
  const dividerStyle = (element: Element) => {
    const style = getComputedStyle(element, "::after");
    return { height: style.height, opacity: style.opacity, color: style.backgroundColor };
  };
  await expect.poll(async () => JSON.stringify(await heightDivider.evaluate(dividerStyle)) === JSON.stringify(await split.evaluate(dividerStyle))).toBe(true);
  await page.getByRole("button", { name: "隐藏匹配列表", exact: true }).click();
  await expect(panel).toHaveCount(0);
});
