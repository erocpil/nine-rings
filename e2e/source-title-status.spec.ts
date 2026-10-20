import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, selectSource, sourceInfo } from "./helpers/source-editor";

async function titlePointerPoints(title: import("@playwright/test").Locator) {
  return title.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const input = element as HTMLInputElement;
    const width = context.measureText(input.value).width;
    const left = rect.left + (Number.parseFloat(style.paddingLeft) || 0);
    const y = rect.top + rect.height / 2;
    return { text: { x: left + Math.min(width / 2, 12), y }, blank: { x: Math.min(rect.right - 3, left + width + 40), y } };
  });
}

test("源码标题回车恢复源码光标，状态栏加号紧邻格式选择且源码首行保留紧凑顶距", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm" })));
  await createBlankDocument(page, "源码标题回车");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  const source = "int first;\nint second;\n";
  await replaceSource(area, source);
  const oldCaret = source.indexOf("second") + 3;
  await selectSource(area, oldCaret);
  const title = page.locator(".markdown-source-title-row .note-title");
  await title.fill("改过名称");
  await title.press("Enter");
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(oldCaret);

  const status = page.locator(".editor-status-bar");
  const format = status.getByRole("combobox", { name: "文件格式", exact: true });
  const create = status.getByRole("button", { name: "在当前路径新建文档", exact: true });
  const formatBox = await format.boundingBox();
  const createBox = await create.boundingBox();
  expect(formatBox).not.toBeNull();
  expect(createBox).not.toBeNull();
  const gap = createBox!.x - (formatBox!.x + formatBox!.width);
  expect(gap).toBeLessThanOrEqual(10);

  expect(await area.evaluate(element => getComputedStyle(element).paddingTop)).toBe("6px");
});

test("窄窗口的只读源码状态栏可通过鼠标滚轮横向浏览", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 780 });
  await createBlankDocument(page, "窄屏只读状态栏");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  await replaceSource(area, "int alpha(void) { return 1; }\n");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();

  const status = page.getByRole("group", { name: "源码状态栏", exact: true });
  await expect(status).toBeVisible();
  const initial = await status.evaluate(element => ({ left: element.scrollLeft, overflow: element.scrollWidth - element.clientWidth }));
  expect(initial.overflow).toBeGreaterThan(0);
  const box = await status.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 160);
  await expect.poll(() => status.evaluate(element => element.scrollLeft)).toBeGreaterThan(initial.left);
  await expect(status.getByRole("button", { name: "在当前路径新建文档", exact: true })).toHaveCount(0);
});

test("文档信息卡只在标题文字范围内悬停时出现", async ({ page }) => {
  await createBlankDocument(page, "标题信息卡范围测试");
  const title = page.locator(".note-title-row .note-title-field .note-title");
  await expect(title).toBeVisible();
  const points = await titlePointerPoints(title);
  await page.mouse.move(points.blank.x, points.blank.y);
  await expect(page.getByRole("tooltip", { name: /标题信息卡范围测试 的文档信息/ })).toHaveCount(0);
  await page.mouse.move(points.text.x, points.text.y);
  await expect(page.getByRole("tooltip", { name: /标题信息卡范围测试 的文档信息/ })).toBeVisible();
});
