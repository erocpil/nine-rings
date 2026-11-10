import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { sourceInfo } from "../helpers/source-editor";

async function fixture(page: Page) {
  await createBlankDocument(page, "浏览前文档");
  await page.evaluate(async () => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true); saveFileBrowserEnabled(true);
  });
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const panel = page.getByRole("region", { name: "本地文件树", exact: true });
  const roots = await page.evaluate(async () => {
    const { localFileService } = await import("/src/lib/local-files/service.ts");
    const file = (path: string, source: string | Uint8Array = "text\n") => {
      const value = new File([source], path.split("/").pop()!);
      Object.defineProperty(value, "webkitRelativePath", { value: path });
      return value;
    };
    const left = localFileService.addFiles([
      file("Left/src/main.c", "int main(void) { return 0; }\n"),
      file("Left/docs/readme.md", "# Browser\n\nBody\n"),
      file("Left/.secret", "hidden"),
      file("Left/binary.bin", new Uint8Array([0, 1, 2])),
      ...Array.from({ length: 260 }, (_, index) => file(`Left/file-${String(index).padStart(3, "0")}.txt`, `entry ${index}\n`)),
    ])!;
    const right = localFileService.addFiles([file("Right/notes.txt", "right\n"), file("Right/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>')])!;
    return { left, right };
  });
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await expect(browser).toBeVisible();
  return { browser, panel, roots, left: browser.getByRole("region", { name: "左侧目录", exact: true }), right: browser.getByRole("region", { name: "右侧目录", exact: true }) };
}

test("双栏独立路径、历史、多选、分页、隐藏项及返回查看器保持状态", async ({ page }) => {
  const { browser, left, right, roots } = await fixture(page);
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption(roots.right.id);
  await expect(right.getByRole("option", { name: /notes.txt/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /src/ })).toBeVisible();
  await expect(left.getByRole("option", { name: /\.secret/ })).toHaveCount(0);
  await left.getByRole("checkbox", { name: "隐藏项" }).check();
  await expect(left.getByRole("option", { name: /\.secret/ })).toBeVisible();
  await left.getByRole("option", { name: /^src/ }).dblclick();
  const main = left.getByRole("option", { name: /main.c/ });
  await expect(main).toBeVisible();
  await expect(right.getByRole("option", { name: /notes.txt/ })).toBeVisible();
  await main.click();
  await expect(main).toHaveAttribute("aria-selected", "true");
  await left.getByRole("button", { name: "上级目录" }).click();
  await left.getByRole("button", { name: "后退目录" }).click();
  await expect(main).toHaveAttribute("aria-selected", "true");
  await main.dblclick();
  const editor = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await expect(editor).toBeVisible();
  await expect.poll(() => sourceInfo(editor).then(value => value.value)).toContain("int main");
  await expect(browser).toBeHidden();
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(browser).toBeVisible();
  await expect(main).toHaveAttribute("aria-selected", "true");
  await expect(right.getByRole("option", { name: /notes.txt/ })).toBeVisible();
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await left.getByRole("button", { name: "加载更多" }).click();
  await expect(left.locator(".file-browser-pane-status")).toContainText("264 项");
  const list = left.getByRole("listbox", { name: "文件列表" });
  await list.evaluate(element => { element.scrollTop = 7200; });
  await expect(left.getByRole("option", { name: /file-22\d/ }).first()).toBeVisible();
  expect(await left.getByRole("option").count()).toBeLessThan(50);
  const scrolledFile = left.getByRole("option", { name: /file-230/ });
  await scrolledFile.dblclick();
  await expect(browser).toBeHidden();
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(browser).toBeVisible();
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(7200);
  await list.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(left.locator(".file-browser-pane-status")).toContainText("选中 264 项");
  await left.getByRole("textbox", { name: "根内相对路径" }).fill("../escape");
  await left.getByRole("textbox", { name: "根内相对路径" }).press("Enter");
  await expect(left.getByRole("alert")).toBeVisible();
});

test("浏览图片复用查看器并返回双栏，不插入背后的数据库文档", async ({ page }) => {
  const { browser, right, roots } = await fixture(page);
  await right.getByRole("combobox", { name: "选择授权目录" }).selectOption(roots.right.id);
  await right.getByRole("option", { name: /image.svg/ }).dblclick();
  await expect(browser).toBeHidden();
  await expect(page.getByRole("button", { name: "插入到文档", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(browser).toBeVisible();
  await expect(right.getByRole("option", { name: /image.svg/ })).toHaveAttribute("aria-selected", "true");
});

test("浏览位置在重新打开时恢复，停用撤销视图，手机切换活动栏", async ({ page }) => {
  const { browser, panel, left, right } = await fixture(page);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  await expect(left.getByRole("option", { name: /main.c/ })).toBeVisible();
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(browser).toHaveCount(0);
  await panel.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("option", { name: /main.c/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(browser).toBeVisible();
  await browser.getByRole("button", { name: "右栏", exact: true }).click();
  await expect(right).toBeVisible();
  await expect(left).toBeHidden();
  expect(await browser.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(async () => {
    const { saveFileBrowserEnabled } = await import("/src/lib/plugin-system/builtin-file-browser.ts");
    saveFileBrowserEnabled(false);
  });
  await expect(browser).toHaveCount(0);
  await expect(page.locator(".note-title")).toHaveValue("浏览前文档");
});

test("独立活动栏入口在停用本地文件后保留授权并打开文件", async ({ page }) => {
  const { browser, left, roots } = await fixture(page);
  await page.evaluate(async () => {
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    saveLocalFilesEnabled(false);
  });
  await expect(page.getByRole("button", { name: "本地文件", exact: true })).toHaveCount(0);
  await expect(browser).toBeVisible();
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区面板" }).getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(left.getByRole("combobox", { name: "选择授权目录" })).toHaveValue(roots.left.id);
  await left.getByRole("option", { name: /^src/ }).dblclick();
  await left.getByRole("option", { name: /main.c/ }).dblclick();
  await expect(page.locator(".cm-content").filter({ visible: true })).toContainText("int main");
  await page.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(left.getByRole("option", { name: /main.c/ })).toBeVisible();
});

for (const presentation of ["split", "overlay"] as const) {
  test(`双栏临时收起固定分栏，重复打开不覆盖快照，返回恢复宽度与固定状态 ${presentation}`, async ({ page }) => {
    await page.addInitScript(mode => {
      localStorage.setItem("nr:sidebarPresentation", mode);
      localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", pinned: true, hidden: false }));
      localStorage.setItem("nr:filesSidebarW", "444");
      localStorage.setItem("nr:workspaceLayout", JSON.stringify({ outlinePinned: true, bookmarkPinned: true }));
    }, presentation);
    const { browser } = await fixture(page);
    const sidebar = page.locator("#workspace-sidebar");
    await expect(sidebar).toHaveClass(/sidebar-hidden/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nr:desktopSidebar")!))).toMatchObject({ panel: "files", hidden: false });
    const navigation = page.getByRole("navigation", { name: "工作区面板", exact: true });
    await navigation.getByRole("button", { name: "双栏浏览", exact: true }).click();
    await expect(browser).toBeVisible(); await expect(sidebar).toHaveClass(/sidebar-hidden/);
    await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect.poll(() => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(444);
    await expect(navigation.getByRole("button", { name: "本地文件", exact: true })).toHaveAttribute("aria-pressed", "true");
    if (presentation === "overlay") await expect(navigation.getByRole("button", { name: "本地文件", exact: true })).toHaveAttribute("data-pinned", "true");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nr:workspaceLayout")!))).toMatchObject({ outlinePinned: true, bookmarkPinned: true });
  });
}

for (const closeAgain of [false, true]) {
  test(`双栏期间主动调整分栏后保留选择，收起=${closeAgain}`, async ({ page }) => {
    const { browser } = await fixture(page);
    const sidebar = page.locator("#workspace-sidebar");
    await expect(sidebar).toHaveClass(/sidebar-hidden/);
    const list = page.getByRole("navigation", { name: "工作区面板", exact: true }).getByRole("button", { name: "文档列表", exact: true });
    await list.click(); await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect(browser).toBeVisible();
    if (closeAgain) { await list.click(); await expect(sidebar).toHaveClass(/sidebar-hidden/); }
    await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
    if (closeAgain) await expect(sidebar).toHaveClass(/sidebar-hidden/);
    else { await expect(sidebar).not.toHaveClass(/sidebar-hidden/); await expect(list).toHaveAttribute("aria-pressed", "true"); }
  });
}

test("双栏期间仅悬停预览不覆盖初始固定分栏", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:sidebarPresentation", "overlay");
    localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", pinned: true, hidden: false }));
  });
  const { browser } = await fixture(page);
  const sidebar = page.locator("#workspace-sidebar");
  const navigation = page.getByRole("navigation", { name: "工作区面板", exact: true });
  await navigation.getByRole("button", { name: "文档列表", exact: true }).hover();
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await sidebar.locator(".sidebar-document-list-search").click({ position: { x: 2, y: 2 } });
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "本地文件", exact: true })).toHaveAttribute("data-pinned", "true");
  await page.mouse.move(1000, 500);
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
});


test("双栏进入前分栏已收起，离开后保持收起", async ({ page }) => {
  const { browser } = await fixture(page);
  const sidebar = page.locator("#workspace-sidebar");
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  const navigation = page.getByRole("navigation", { name: "工作区面板", exact: true });
  await navigation.getByRole("button", { name: "本地文件", exact: true }).click();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await navigation.getByRole("button", { name: "双栏浏览", exact: true }).click();
  await expect(browser).toBeVisible();
  await browser.getByRole("button", { name: "返回原视图", exact: true }).click();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
});
