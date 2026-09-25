import { test, expect } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import {
  sourceInfo,
  selectSource,
  replaceSource,
  scrollSourceTo,
} from "./helpers/source-editor";

test("源码编辑高亮、列表续写、Tab、搜索替换和视图切换撤销", async ({
  page,
}) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await replaceSource(area, "# Heading\n\n15. item");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("# Heading\n\n15. item");
  await selectSource(area, (await sourceInfo(area)).value.length);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("16. ");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("body");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("\n\nbody");
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("    ");
  await page.keyboard.press("Shift+Tab");
  await expect(area.locator("span").first()).toBeVisible();
  const before = (await sourceInfo(area)).value;
  await selectSource(area, before.indexOf("body"), before.indexOf("body") + 4);
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("**body**");
  const changed = (await sourceInfo(area)).value;
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect((await sourceInfo(area)).value).toBe(changed);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(before);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(changed);
  await page.getByRole("button", { name: "查找替换", exact: true }).click();
  await page.locator('.cm-search input[name="search"]').fill("body");
  await page.locator('.cm-search input[name="replace"]').fill("updated");
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("**updated**");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("**updated**");
});

test("5000 行源码按视口挂载，末行滚到顶部并保留保存的原文", async ({
  page,
}) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  test.setTimeout(90000);
  const value = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
  await replaceSource(area, value);
  await expect
    .poll(() => page.locator(".markdown-cm-host .cm-line").count())
    .toBeLessThan(200);
  await scrollSourceTo(area, "line 4999");
  await expect
    .poll(() =>
      area
        .locator(".cm-line")
        .filter({ hasText: /^line 4999$/ })
        .evaluate((el) =>
          Math.abs(
            el.getBoundingClientRect().top -
              el.closest(".cm-scroller")!.getBoundingClientRect().top,
          ),
        ),
    )
    .toBeLessThan(20);
  await expect(page.locator(".cm-editor.cm-focused")).toHaveCSS(
    "outline-style",
    "none",
  );
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect((await sourceInfo(area)).value).toBe(value);
});

test("手机源码引用续写、围栏高亮、折叠、跳转与只读保护", async ({ page }) => {
  await createBlankDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await replaceSource(area, "> 引用");
  await selectSource(area, 4);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toBe("> 引用\n> ");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("中文标题");
  await expect
    .poll(async () => (await sourceInfo(area)).value)
    .toContain("\n中文标题");
  const value = "# 中文标题\n\n```javascript\nconst answer = 42;\n```\n\n正文";
  await replaceSource(area, value);
  await expect(
    area.locator("span").filter({ hasText: /^const$/ }),
  ).toBeVisible();
  await page
    .locator(".cm-foldGutter .cm-gutterElement")
    .filter({ hasText: "⌄" })
    .first()
    .click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  await page.locator(".cm-foldPlaceholder").click();
  await page.getByRole("button", { name: "跳转行", exact: true }).click();
  await page.locator(".cm-goto-line input").fill("4");
  await page.locator(".cm-goto-line input").press("Enter");
  expect((await sourceInfo(area)).selectionStart).toBe(value.indexOf("const"));
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).readonly).toBe(true);
  await area.focus();
  await page.keyboard.insertText("不应写入");
  expect((await sourceInfo(area)).value).toBe(value);
  await expect(
    page.getByRole("button", { name: "加粗", exact: true }),
  ).toBeDisabled();
});


test("只读源码点击高亮且折叠命中区与行号对齐", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true, highlight_active_line: true })));
  await createBlankDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const value = "# Heading\n\nfirst body\n\n## Child\n\nsecond body";
  await replaceSource(area, value);
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  for (const text of ["first body", "second body"]) {
    await area.locator(".cm-line").filter({ hasText: text }).click();
    await expect(area.locator(".cm-activeLine")).toHaveText(text);
    await expect(page.locator(".markdown-cm-host .cm-cursor")).toBeVisible();
    const animation = await page.locator(".markdown-cm-host .cm-cursorLayer").evaluate(el => getComputedStyle(el).animationName);
    expect(animation).toMatch(/^cm-blink/);

  }
  await expect(area).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".markdown-cm-host .cm-selectionLayer")).toHaveCount(0);
  const copied = await area.evaluate(el => {
    const lines = [...el.querySelectorAll(".cm-line")];
    const first = lines.find(line => line.textContent === "first body")!;
    const last = lines.find(line => line.textContent === "second body")!;
    const start = document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode()!;
    const end = document.createTreeWalker(last, NodeFilter.SHOW_TEXT).nextNode()!;
    // Native mobile handles can extend a selection in either direction.
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(end, 6, start, 2);
    const clipboardData = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
    return { text: clipboardData.getData("text/plain"), selected: selection.toString(), color: getComputedStyle(first, "::selection").backgroundColor, selectable: getComputedStyle(first).getPropertyValue("user-select") || getComputedStyle(first).getPropertyValue("-webkit-user-select") };
  });
  expect(copied.text).toBe("rst body\n\n## Child\n\nsecond");
  expect(copied.selected).toContain("rst body");
  expect(copied.selectable).toBe("text");
  expect(copied.color).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator(".markdown-cm-host .cm-cursor")).toHaveCount(0);
  expect((await sourceInfo(area)).value).toBe(value);
  await area.evaluate(() => window.getSelection()?.removeAllRanges());
  const marker = page.locator(".cm-foldGutter .cm-gutterElement").filter({ hasText: "⌄" }).first();
  const number = page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^1$/ });
  const m = (await marker.boundingBox())!, n = (await number.boundingBox())!;
  expect(Math.abs(m.y - n.y)).toBeLessThan(1);
  expect(m.width).toBeGreaterThanOrEqual(28);
  const arrow = (await marker.locator("span").boundingBox())!;
  expect(Math.abs(arrow.height - n.height)).toBeLessThan(1);
  expect(n.x - m.x - m.width).toBeLessThan(3);
  await marker.click({ position: { x: 3, y: 10 } });
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  await page.getByRole("button", { name: "切换为可编辑", exact: true }).click();
  await expect(area).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".markdown-cm-host .cm-selectionLayer")).toHaveCount(1);
  await expect(area).toHaveAttribute("aria-readonly", "false");

});
