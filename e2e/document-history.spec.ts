import { sourceInfo, replaceSource } from "./helpers/source-editor";
import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

const editor = (page: Page) => page.locator(".note-editor .ProseMirror");
async function fixture(page: Page) {
  await createBlankDocument(page);
  await editor(page).evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent({ type: "doc", content: Array.from({ length: 45 }, (_, index) => ({
      type: index % 10 === 0 ? "heading" : "paragraph",
      ...(index % 10 === 0 ? { attrs: { level: 2 } } : {}),
      content: [{ type: "text", text: `位置 ${index}：用于验证历史跳转的正文内容。` }],
    })) }, true);
    instance.commands.setTextSelection(1);
  });
  return (await page.evaluate(() => localStorage.getItem("nr:lastNote")))!;
}
async function location(page: Page) {
  return editor(page).evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    return { from: instance.state.selection.from, to: instance.state.selection.to };
  });
}
async function history(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/stores/useNavigationStore.ts";
    const { useNavigationStore } = await import(/* @vite-ignore */ path);
    const { entries, index, target } = useNavigationStore.getState();
    return { entries, index, target };
  });
}
async function newDocument(page: Page, title: string) {
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue(title);
  return (await page.evaluate(() => localStorage.getItem("nr:lastNote")))!;
}
async function sideButton(page: Page, button: number) {
  await page.evaluate(button => {
    for (const type of ["mousedown", "mouseup", "auxclick"]) {
      const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
      if (document.dispatchEvent(event)) throw new Error(`${type} was not canceled`);
    }
  }, button);
}

test("同文档后退前进恢复光标，编辑不刷历史，新跳转清除前进分支", async ({ page }) => {
  await fixture(page);
  const initial = await location(page);
  await editor(page).locator("p").nth(25).click();
  const count = (await history(page)).entries.length;
  await page.keyboard.type("typed");
  await page.keyboard.press("ArrowLeft");
  expect((await history(page)).entries).toHaveLength(count);
  const destination = await location(page);
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => location(page)).toEqual(initial);
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await expect.poll(() => location(page)).toEqual(destination);
  await expect(editor(page)).toContainText("typed");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => location(page)).toEqual(initial);
  await editor(page).locator("p").nth(12).click();
  await expect(page.getByRole("button", { name: "前进", exact: true })).toBeDisabled();
});

test("跨文档恢复位置，鼠标侧键一次只跳一次且弹窗内不切换文档", async ({ page }) => {
  const first = await fixture(page);
  await editor(page).locator("p").nth(22).click();
  const firstPosition = await location(page);
  const second = await newDocument(page, "第二篇导航文档");
  await editor(page).fill("第二篇的内容");
  const secondPosition = await location(page);
  await sideButton(page, 3);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(first);
  await expect.poll(() => location(page)).toEqual(firstPosition);
  await sideButton(page, 4);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(second);
  await expect.poll(() => location(page)).toEqual(secondPosition);
  await page.getByTitle("设置").click();
  await sideButton(page, 3);
  expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(second);
});

test("删除的中间文档会被跳过", async ({ page }) => {
  const first = await fixture(page);
  const second = await newDocument(page, "待删除文档");
  await newDocument(page, "当前文档");
  await page.evaluate(async id => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    await api.notes.delete(id);
  }, second);
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(first);
});

test("Mac 使用 Command+Option 方向键，保留 Option 文本移动", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "MacIntel" }));
  await fixture(page);
  const start = await location(page);
  await editor(page).locator("p").nth(15).click();
  const end = await location(page);
  expect(await editor(page).evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true })))).toBe(true);
  await page.keyboard.press("Meta+Alt+ArrowLeft");
  await expect.poll(() => location(page)).toEqual(start);
  await page.keyboard.press("Meta+Alt+ArrowRight");
  await expect.poll(() => location(page)).toEqual(end);
});

test("真实 Chromium 鼠标后退键不会离开网页", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP mouse side buttons require Chromium");
  await fixture(page);
  const start = await location(page);
  await editor(page).locator("p").nth(18).click();
  await page.evaluate(() => window.history.pushState({}, "", "#side-button-sentinel"));
  const url = page.url();
  const cdp = await page.context().newCDPSession(page);
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await cdp.send("Input.dispatchMouseEvent", { type, x: 800, y: 350, button: "back", clickCount: 1 });
  }
  await expect.poll(() => location(page)).toEqual(start);
  await expect(page).toHaveURL(url);
});

test("同一段落内搜索匹配跳转也记录历史", async ({ page }) => {
  await fixture(page);
  await editor(page).evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent('<p>match one match two match three</p>', true);
    instance.commands.setTextSelection(1);
  });
  await page.keyboard.press("Alt+f");
  await page.getByRole("textbox", { name: "在当前文档中查找" }).fill("match");
  await page.getByRole("button", { name: "下一处匹配", exact: true }).click();
  const first = await location(page);
  await page.getByRole("button", { name: "下一处匹配", exact: true }).click();
  const second = await location(page);
  expect(second).not.toEqual(first);
  await page.getByRole("button", { name: "关闭查找", exact: true }).click();
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => location(page)).toEqual(first);
  await page.getByRole("button", { name: "前进", exact: true }).click();
  await expect.poll(() => location(page)).toEqual(second);
});

test("导航前保存失败时保留文档、光标和历史", async ({ page }) => {
  const id = await fixture(page);
  await editor(page).locator("p").nth(12).click();
  await page.evaluate(id => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "notes" && value.id === id) throw new DOMException("history-save-test", "QuotaExceededError");
      return original.call(this, value, key);
    };
  }, id);
  await page.keyboard.type("unsaved");
  const before = await location(page);
  const beforeIndex = (await history(page)).index;
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看保存错误详情", exact: true })).toBeVisible();
  expect(await location(page)).toEqual(before);
  expect((await history(page)).index).toBe(beforeIndex);
  expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(id);
  await expect(editor(page)).toContainText("unsaved");
});

for (const virtual of [false, true]) {
  test(`只读目录跳转可后退前进，局部渲染=${virtual}`, async ({ page }) => {
    if (virtual) await page.addInitScript(() => localStorage.setItem("nr:experimentalReadonlyRendering", "true"));
    await fixture(page);
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (virtual) await expect(page.getByRole("document", { name: "只读正文", exact: true }).locator("h2").first()).toContainText("位置 0：");
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    await page.locator(virtual ? ".vr-outline-row > button:last-child" : ".document-outline-link").filter({ hasText: "位置 30：" }).click();
    const destination = (await history(page)).entries[(await history(page)).index];
    await page.getByRole("button", { name: "后退", exact: true }).click();
    await expect.poll(async () => (await history(page)).target).toBeNull();
    const root = page.locator(".note-editor-scroll");
    await expect.poll(() => root.evaluate(element => element.scrollTop)).toBeLessThan(120);
    await page.getByRole("button", { name: "前进", exact: true }).click();
    await expect.poll(async () => {
      const state = await history(page);
      return state.target === null ? state.entries[state.index] : null;
    }).toEqual(destination);
    await expect.poll(() => root.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  });
}

test("源码视图后退保持源码并恢复位置，手机标题栏按钮可见", async ({ page }) => {
  await fixture(page);
  await editor(page).locator("p").nth(20).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toBeVisible();
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect(source).toBeVisible();
  await expect.poll(() => sourceInfo(source).then(info => info.selectionStart)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "后退", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "前进", exact: true })).toBeInViewport();
});

test("连续历史位置所属文档已删除时仍能返回更早文档", async ({ page }) => {
  const first = await fixture(page);
  const second = await newDocument(page, "多个位置的已删除文档");
  await editor(page).evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent('<p>one</p><p>two</p>', true);
    instance.commands.setTextSelection(1);
  });
  await editor(page).locator("p").last().click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
  await page.evaluate(async id => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    await api.notes.delete(id);
  }, second);
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(first);
});

test("同段落附近点击合并历史，显式跳转仍可后退", async ({ page }) => {
  await fixture(page);
  const paragraph = editor(page).locator("p").nth(8);
  await paragraph.click({ position: { x: 10, y: 10 } });
  const count = (await history(page)).entries.length;
  await paragraph.click({ position: { x: 50, y: 10 } });
  expect((await history(page)).entries).toHaveLength(count);
  const previous = await location(page);
  await editor(page).evaluate(element => {
    const instance = (element as HTMLElement & { editor: Editor }).editor;
    instance.chain().setTextSelection(instance.state.selection.from + 1).command(({ tr }) => { tr.setMeta("navigation-jump", true); return true; }).run();
  });
  expect((await history(page)).entries).toHaveLength(count + 1);
  await page.getByRole("button", { name: "后退", exact: true }).click();
  await expect.poll(() => location(page)).toEqual(previous);
});
