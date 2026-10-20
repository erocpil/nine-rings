import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo, selectSource, scrollSourceTo } from "./helpers/source-editor";

for (const language of ["", "python", "json"]) test(`${language || "text"} 仅提供源码，保存重开保留字面内容且不继续 Markdown 列表`, async ({ page }) => {
  await createBlankDocument(page, "原始文本");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption(language);
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  await expect(page.getByRole("button", { name: "渲染", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "并排预览", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加粗", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import("/src/lib/native-menu-registry.ts")).nativeMenuSnapshot().find(item => item.id === "document.source")?.enabled)).toBe(false);
  const raw = '# literal\n\n*stars*\n\tindented  \n|a|b|\n|---|---|\n|1|2|\n\n- item';
  await replaceSource(area, raw);
  await selectSource(area, raw.length);
  await page.keyboard.press("Enter");
  const afterEnter = (await sourceInfo(area)).value;
  expect(afterEnter.startsWith(raw + "\n")).toBe(true);
  expect(afterEnter.slice(raw.length + 1).trim()).toBe("");
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content.metadata?.sourceText;
  })).toBe(afterEnter);
  await page.reload();
  await expect(area).toBeVisible();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(afterEnter);
  await expect(page.getByRole("combobox", { name: "文件格式", exact: true })).toHaveValue(language);
});

for (const language of ["flow", "mermaid"]) test(`${language} 整份文档支持源码、渲染及并排预览，不需要围栏`, async ({ page }) => {
  await createBlankDocument(page, "独立图文");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption(language);
  const area = page.locator(".cm-content");
  // Switching an empty Markdown render to a renderable type starts in render.
  if (await page.getByRole("button", { name: "源码", exact: true }).isVisible()) await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(area).toBeEditable();
  const raw = language === "flow" ? "### 第一阶段\n\n检查输入。\n\n### 第二阶段\n\n执行任务。" : "flowchart LR\n  A[开始] --> B[结束]";
  await replaceSource(area, raw);
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  const preview = page.locator(".markdown-preview-pane");
  await expect(preview).toBeVisible();
  if (language === "flow") await expect(preview.locator(".flow-block-content")).toContainText("第二阶段");
  else await expect(preview.locator("svg[aria-roledescription]")).toBeVisible();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  const rendered = page.getByLabel(language === "flow" ? "Flow 渲染" : "Mermaid 渲染", { exact: true });
  await expect(rendered).toBeVisible();
  if (language === "flow") await expect(rendered).toContainText("第二阶段");
  else await expect(rendered.locator("svg[aria-roledescription]")).toBeVisible();
  for (let reopen = 0; reopen < 2; reopen++) {
    await page.reload();
    await expect(rendered).toBeVisible();
  }
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  if (language === "mermaid") {
    await replaceSource(area, "flowchart ???");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(rendered).toContainText(/失败|错误|无法/);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect.poll(async () => (await sourceInfo(area)).value).toBe("flowchart ???");
  }
});

test("Text 与 Markdown 往返只改变解释方式，不增加反斜线或丢失换行", async ({ page }) => {
  await createBlankDocument(page, "往返格式");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("");
  const area = page.locator(".cm-content");
  const raw = "## 标题\n\n*斜体* 与 `代码`\n\n- 列表\n\n";
  await replaceSource(area, raw);
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("markdown");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror h2")).toHaveText("标题");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
});

test("源码专用文档重开恢复位置，只读后保留浏览能力并禁止编辑", async ({ page }) => {
  await createBlankDocument(page, "源码恢复位置");
  await page.getByRole("combobox", { name: "文件格式", exact: true }).selectOption("");
  const area = page.locator(".cm-content");
  const raw = Array.from({ length: 220 }, (_, index) => `line ${String(index).padStart(3, "0")} literal *Markdown*`).join("\n");
  await replaceSource(area, raw);
  await scrollSourceTo(area, "line 120");
  const top = (await sourceInfo(area)).scrollTop;
  expect(top).toBeGreaterThan(500);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`nr:readingState:${localStorage.getItem("nr:lastNote")}`) ?? "{}").source?.scrollTop)).toBe(top);
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content.metadata?.sourceText;
  })).toBe(raw);
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await expect(area).toHaveAttribute("aria-readonly", "true");
  const locked = await sourceInfo(area);
  await page.reload();
  await expect(area).toBeVisible();
  await expect(area).toHaveAttribute("aria-readonly", "true");
  // CM may adjust virtual spacer pixels after mounting read-only content;
  // the actual first visible source character is the reading-position contract.
  await expect.poll(async () => (await sourceInfo(area)).offset).toBe(locked.offset);
  await expect(page.getByRole("combobox", { name: "文件格式", exact: true })).toBeDisabled();
});

test("Markdown 源码粘贴 C 文本并切换 C/C++ 保留原文和等宽字体", async ({ page }) => {
  await createBlankDocument(page, "粘贴原始代码");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.locator(".cm-content");
  const raw = '#include <stdio.h>\n\n/* *literal* [a](b) */\nint main(void) {\n\tprintf("a\\nb");  \n\treturn 0;\n}\n\n';
  await selectSource(area, 0);
  await area.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    clipboardData.setData("text/html", "<h1>incorrect rich clipboard</h1>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, raw);
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  const picker = page.getByRole("combobox", { name: "文件格式", exact: true });
  await expect(picker.locator('option[value="csharp"], option[value="cpp"]')).toHaveCount(0);
  await picker.selectOption("c");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
  await expect(page.locator(".cm-scroller")).toHaveCSS("font-family", /monospace/);
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))?.content.metadata?.sourceText;
  })).toBe(raw);
  await page.reload();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(raw);
});
