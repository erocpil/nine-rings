import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("源码点击高亮全词匹配，Ctrl/Command+单击打开可跳转的匹配面板", async ({ page }) => {
  await createBlankDocument(page, "源码全词匹配");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(area).toBeVisible({ timeout: 20000 });
  const source = "int packet_count = 0;\nint packet_counted = packet_count;\nvoid use_packet_count(void) { packet_count++; }\n";
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
  await expect.poll(() => area.locator(".cm-source-word-match").count()).toBe(3);
  await expect(area.locator(".cm-source-word-match-active")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "同词匹配", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "源码符号", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "源码符号", exact: true })).toBeVisible();
  await clickWord(source.lastIndexOf(word) + 2, ["Control", "Meta"]);
  const panel = page.getByRole("navigation", { name: "同词匹配列表", exact: true });
  await expect(panel).toBeVisible();
  const dock = page.getByRole("complementary", { name: "固定阅读面板" });
  await expect(dock.locator(".document-panel-slot[data-panel='outline']")).toBeVisible();
  await expect(dock.locator(".document-panel-matches-slot")).toBeVisible();
  expect(await dock.locator(":scope > .document-panel-dock-main").evaluate(main => main.compareDocumentPosition(main.nextElementSibling!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(panel.locator(".document-source-match-row")).toHaveCount(3);
  expect(await panel.locator(".document-source-match-line").allTextContents()).toEqual(["1", "2", "3"]);
  await panel.locator(".document-source-match-row").last().click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.lastIndexOf(word));
  await expect.poll(async () => (await sourceInfo(area)).selectionEnd).toBe(source.lastIndexOf(word) + word.length);
  await page.getByRole("button", { name: "隐藏匹配列表", exact: true }).click();
  await expect(panel).toHaveCount(0);
});
