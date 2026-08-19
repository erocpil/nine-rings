import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe("编辑器复制粘贴", () => {
  test("复制行内文本后粘贴不会引入首尾空白", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("前缀 中间文本 后缀");

    await editor.evaluate((element) => {
      const text = element.querySelector("p")?.firstChild;
      if (!text) throw new Error("editor text node not found");
      const value = text.textContent ?? "";
      const start = value.indexOf("中间文本");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + "中间文本".length);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("中间文本");

    await editor.evaluate((element) => {
      const text = element.querySelector("p")?.firstChild;
      if (!text) throw new Error("editor text node not found");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.textContent?.length ?? 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+V");

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("前缀 中间文本 后缀中间文本");
  });

  test("复制整行文本后粘贴只产生预期内容", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("整行文本");
    await editor.press("Control+A");
    await page.keyboard.press("Control+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("整行文本");
    await editor.evaluate((element) => {
      const paragraph = element.querySelector("p");
      const text = paragraph?.firstChild;
      if (!paragraph || !text) throw new Error("editor text node not found");
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.textContent?.length ?? 0);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press("Control+V");

    await expect(editor).toHaveText("整行文本整行文本");
    await expect(editor.locator("p")).toHaveCount(1);
  });

  test("通过编辑器粘贴按钮粘贴单段 HTML 不产生首尾空段落", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("前缀 后缀");
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob(["<p>中间文本</p>"], { type: "text/html" }),
          "text/plain": new Blob(["中间文本"], { type: "text/plain" }),
        }),
      ]);
    });
    await editor.click();
    await page.keyboard.press("End");
    await page.getByTitle("粘贴 (Ctrl+V)").click();

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("前缀 后缀中间文本");
  });

  test("Windows 风格段内边界换行不会变成粘贴前后空行", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("已有内容");
    await editor.press("End");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<p data-pm-slice="1 1 []"><br><br>粘贴正文<br><br></p>',
      );
      clipboardData.setData("text/plain", "\r\n\r\n粘贴正文\r\n\r\n");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("已有内容粘贴正文");
  });

  test("Windows Office 风格嵌套边界空块不会变成大段空白", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("已有内容");
    await editor.press("End");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<br><div><p>&nbsp;</p><p><span><o:p>&nbsp;</o:p></span></p><p>粘贴正文</p><p>&nbsp;</p></div><br class="Apple-interchange-newline">',
      );
      clipboardData.setData("text/plain", "\r\n\r\n粘贴正文\r\n\r\n");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    await expect(editor.locator("p")).toHaveCount(1);
    await expect(editor.locator("p")).toHaveText("已有内容粘贴正文");
  });

  test("HTML 表格粘贴为可编辑表格节点", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        "<table><thead><tr><th>能力</th><th>主要证据</th></tr></thead><tbody><tr><td>DPDK</td><td>百度 / Bless / 商汤</td></tr><tr><td>NIC</td><td>CX-5/CX-6 / Bless</td></tr></tbody></table>",
      );
      clipboardData.setData(
        "text/plain",
        "能力主要证据DPDK百度 / Bless / 商汤NICCX-5/CX-6 / Bless",
      );
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    const table = editor.locator(":scope > table, :scope > .tableWrapper table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("th")).toHaveText(["能力", "主要证据"]);
    await expect(table.locator("td")).toHaveText(["DPDK", "百度 / Bless / 商汤", "NIC", "CX-5/CX-6 / Bless"]);
  });

  test("单行 Markdown 标题粘贴转换为一级标题", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "# Resume Claim Defense");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    });

    await expect(editor.locator("h1")).toHaveText("Resume Claim Defense");
  });

  test("Markdown 多级混合列表按层级渲染", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const markdown = [
      "- **VFIO/UIO接入层**",
      "  - 将PCI BAR以MMIO方式暴露给进程",
      "  1. Child",
      "    - Grandchild",
      "- Sibling",
    ].join("\n");
    const editor = page.locator(".ProseMirror");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);

    const rootList = editor.locator(":scope > ul");
    const rootItems = rootList.locator(":scope > li");
    const bulletChildList = rootItems.first().locator(":scope > ul");
    const childList = rootItems.first().locator(":scope > ol");
    const grandchildList = childList.locator(":scope > li").first().locator(":scope > ul");
    await expect(rootItems).toHaveCount(2);
    await expect(rootItems.first().locator(":scope > p strong")).toHaveText("VFIO/UIO接入层");
    await expect(bulletChildList).toHaveCount(1);
    await expect(childList).toHaveCount(1);
    await expect(grandchildList).toHaveCount(1);
    await expect(grandchildList).toContainText("Grandchild");
    await expect(rootList).toHaveCSS("list-style-type", "disc");
    await expect(bulletChildList).toHaveCSS("list-style-type", "circle");
    await expect(childList).toHaveCSS("list-style-type", "lower-alpha");
    await expect(grandchildList).toHaveCSS("list-style-type", "square");
  });

  test("同时携带 HTML 的 Markdown 仍完整格式化", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const markdown = [
      "# 面试复习材料:DPDK / 内核网络 / SR-IOV & VIRTIO",
      "",
      "> 组织方式:每个知识点按【概念 → 原理 → 使用场景 → 值得关注项】展开。",
      "",
      "---",
      "",
      "# Part 1. DPDK 相关",
      "",
      "## 1.1 DPDK 整体架构 & EAL(环境抽象层)",
      "",
      "概念",
    ].join("\n");
    const editor = page.locator(".ProseMirror");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      clipboardData.setData("text/html", `<div>${text.replaceAll("\n", "<br>")}</div>`);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);

    await expect(editor.locator("h1")).toHaveCount(2);
    await expect(editor.locator("h1").first()).toHaveText("面试复习材料:DPDK / 内核网络 / SR-IOV & VIRTIO");
    await expect(editor.locator("blockquote")).toContainText("组织方式");
    await expect(editor.locator("h2")).toHaveText("1.1 DPDK 整体架构 & EAL(环境抽象层)");
    await expect(editor.locator("p").last()).toHaveText("概念");
    await expect(editor).not.toContainText("# 面试复习材料:DPDK / 内核网络 / SR-IOV & VIRTIO");
  });

  test("Markdown 表格粘贴后渲染为表格", async ({ page }) => {
    await page.goto("/");

    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const markdown = [
      "# Part 0. 内容索引",
      "",
      "| 技术领域 | 对应章节 | 核心内容 |",
      "|---|---|---|",
      "| DPDK框架 | 1.1～1.6 | EAL初始化 |",
      "| Flow Director | 1.7 | queue级资源隔离 |",
      "",
      "---",
    ].join("\n");
    const editor = page.locator(".ProseMirror");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);

    await expect(editor.locator("h1")).toHaveText("Part 0. 内容索引");
    const table = editor.locator(":scope > table, :scope > .tableWrapper table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("th")).toHaveText(["技术领域", "对应章节", "核心内容"]);
    await expect(table.locator("td").last()).toHaveText("queue级资源隔离");
  });

  test("编辑后的表格可规范化导出为 Markdown", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    const markdown = "| 名称 | 数值 |\n| :--- | ---: |\n| `a \\| b` | **42** |";
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, markdown);
    const table = editor.locator("table");
    await expect(table).toHaveCount(1);
    await table.locator("td").first().click();
    await page.getByTitle("当前列居中").click();
    await expect(table.locator("th").first()).toHaveCSS("text-align", "center");
    await expect(table.locator("td").first()).toHaveCSS("text-align", "center");
    await page.getByTitle("在下方添加行").click();
    await expect(table.locator("tr")).toHaveCount(3);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTitle("导出 Markdown").click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const exported = await readFile(path!, "utf8");
    expect(exported).toContain("| 名称 | 数值 |");
    expect(exported).toContain("| :---: | ---: |");
    expect(exported).toContain("| `a \\| b` | **42** |");
  });

  test("超过五万字符的 Markdown 可替换已有内容", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

    const editor = page.locator(".ProseMirror");
    await editor.fill("旧内容");
    await editor.click();
    await page.keyboard.press("Control+A");
    const markdown = [
      "# 长文档粘贴",
      "",
      ...Array.from({ length: 420 }, (_, index) => [
        `## 章节 ${index + 1}`,
        "",
        "这是用于验证超过五万字符的 Markdown 粘贴不会被拒绝的正文内容。".repeat(5),
      ].join("\n")),
    ].join("\n\n");
    expect(markdown.length).toBeGreaterThan(50_000);
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);

    await expect(editor.locator("h1").first()).toHaveText("长文档粘贴");
    await expect(editor.locator("h2").last()).toHaveText("章节 420");
    await expect(editor).not.toContainText("旧内容");
  });
});

test.describe("文档树移动", () => {
  test("可新建自定义一级目录", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("文档树").click();
    await page.getByTitle("新建文档").click();

    await page.getByPlaceholder("文档标题...").fill("自定义目录文档");
    await page.locator("select.dialog-select").selectOption("__custom_root__");
    await page.getByPlaceholder("一级目录 (如 private)").fill("private");
    await page.getByPlaceholder("子路径 (如 nine-rings)").fill("ip");
    await expect(page.locator(".dialog-path-preview code")).toHaveText("private-ip");
    await page.getByRole("button", { name: "创建" }).click();

    await expect(page.locator(".doc-tree-folder").filter({ hasText: "private-ip" })).toHaveCount(1);
  });

  test("移动文档后树和当前编辑器刷新，页面重载后仍在目标目录", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("文档树").click();
    await page.getByTitle("新建文档").click();

    await page.getByPlaceholder("文档标题...").fill("移动回归文档");
    await page.getByPlaceholder("子路径 (如 nine-rings)").fill("move-e2e");
    await page.getByRole("button", { name: "创建" }).click();

    const sourceFolder = page.locator(".doc-tree-folder").filter({ hasText: "move-e2e" });
    await expect(sourceFolder).toHaveCount(1);
    await sourceFolder.click({ button: "right" });
    page.once("dialog", (dialog) => dialog.accept("archives/move-e2e"));
    await page.getByRole("button", { name: "移动到…" }).click();

    await expect(page.locator(".doc-tree-folder").filter({ hasText: "archives" })).toHaveCount(1);
    await expect(page.locator(".doc-tree-folder").filter({ hasText: "move-e2e" })).toHaveCount(1);
    await expect(page.locator(".note-title")).toHaveValue("移动回归文档");

    await page.reload();
    await page.getByTitle("文档树").click();
    await expect(page.locator(".doc-tree-folder").filter({ hasText: "archives" })).toHaveCount(1);
    await expect(page.locator(".doc-tree-doc").filter({ hasText: "移动回归文档" })).toHaveCount(1);
  });
});
