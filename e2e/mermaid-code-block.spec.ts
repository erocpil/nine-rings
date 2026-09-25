import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("Mermaid 代码块保留源码并可在图形与源码间切换", async ({ page }) => {
  await createBlankDocument(page);
  const source = "flowchart LR\n  A[开始] --> B[完成]";
  await page.locator(".note-editor .ProseMirror").evaluate((element, value) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: value }],
    }] }, true);
  }, source);
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.getByLabel("代码语言")).toHaveValue("mermaid");
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "显示 Mermaid 图形" }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  const svgId = await block.locator(".mermaid-diagram svg").getAttribute("id");
  await block.getByRole("button", { name: "折叠代码块" }).click();
  await expect(block.locator(".mermaid-diagram")).toBeHidden();
  await block.getByRole("button", { name: "展开代码块" }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  expect(await block.locator(".mermaid-diagram svg").getAttribute("id")).toBe(svgId);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(block.locator(".mermaid-diagram svg")).toBeVisible();
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
  await expect(block.locator("pre code")).toHaveText(source);
  await block.getByRole("button", { name: "显示 Mermaid 图形" }).click();
  const readonlyControls = block.locator("[data-mermaid-controls]");
  await readonlyControls.getByRole("button", { name: "放大图表", exact: true }).click();
  await expect(readonlyControls.getByRole("status")).toHaveText("105%");
  const readonlySvg = await block.locator(".mermaid-diagram svg").getAttribute("id");
  await block.getByRole("button", { name: "折叠代码块", exact: true }).click();
  await expect(block.locator(".mermaid-diagram")).toBeHidden();
  await block.getByRole("button", { name: "展开代码块", exact: true }).click();
  expect(await block.locator(".mermaid-diagram svg").getAttribute("id")).toBe(readonlySvg);
  await expect(readonlyControls.getByRole("status")).toHaveText("105%");
});

test("无效 Mermaid 保留切回源码的入口", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "not a diagram" }],
    }] }, true);
  });
  const block = page.locator(".note-editor .code-block-wrap");
  await expect(block.locator(".mermaid-diagram-error")).toBeVisible();
  await block.getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(block.locator("pre code")).toBeVisible();
});

test("PDF 打印视图将 Mermaid 源码绘制成图形", async ({ page }) => {
  await page.goto("/");
  const rendered = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const printWindow = frame.contentWindow!;
    printWindow.print = () => undefined;
    const originalOpen = window.open;
    window.open = (() => printWindow) as typeof window.open;
    try {
      const { exportDocumentAsPdf } = await import("../src/lib/pdf-export");
      exportDocumentAsPdf({
        title: "Mermaid 导出",
        contentHtml: '<pre data-language="mermaid"><code>flowchart LR\nA--&gt;B</code></pre>',
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (printWindow.document.querySelector(".print-mermaid svg")) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    } finally {
      window.open = originalOpen;
      frame.remove();
    }
  });
  expect(rendered).toBe(true);
});

test("Mermaid 弹层支持滚轮缩放、拖动和适应窗口", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\nA --> B" }],
    }] }, true);
  });
  await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
  const dialog = page.getByRole("dialog", { name: "图像工作区" });
  const viewport = dialog.locator(".mermaid-diagram-viewport");
  await expect(viewport.locator("svg")).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toBeVisible();

  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(300);
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toHaveCount(0);
  const beforeDrag = await viewport.locator(".mermaid-diagram-canvas").getAttribute("style");
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 35, { steps: 5 });
  await page.mouse.up();
  // Small diagrams remain centered; zoom past the viewport before panning.
  await expect(viewport.locator(".mermaid-diagram-canvas")).toHaveAttribute("style", beforeDrag!);
  await viewport.evaluate(el => {
    const box = el.getBoundingClientRect();
    for (let i = 0; i < 45; i++) el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, cancelable: true }));
  });
  await expect(dialog.locator(".mermaid-diagram-controls [role=status]")).toHaveText("800%");
  for (const direction of [1, -1]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await viewport.dispatchEvent("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x + direction * 10000, clientY: y + direction * 10000 });
    await page.mouse.up();
    const imageBox = (await viewport.locator("svg").boundingBox())!;
    for (const [start, size, frameStart, frameSize] of [[imageBox.x, imageBox.width, box!.x, box!.width], [imageBox.y, imageBox.height, box!.y, box!.height]]) {
      if (size >= frameSize) {
        expect(start).toBeLessThanOrEqual(frameStart + 1);
        expect(start + size).toBeGreaterThanOrEqual(frameStart + frameSize - 1);
      } else expect(Math.abs(start + size / 2 - frameStart - frameSize / 2)).toBeLessThan(2);
    }
  }
  await dialog.getByRole("button", { name: "适应窗口" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "100%" })).toBeVisible();
  await expect(viewport.locator(".mermaid-diagram-canvas")).toHaveAttribute("style", /translate\(0px(?:, 0px)?\) scale\(1\)/);
  await dialog.getByRole("group", { name: "Mermaid 视图" }).getByRole("button", { name: "显示 Mermaid 源码" }).click();
  await expect(dialog.locator(".code-block-inner pre code")).toHaveText("flowchart LR\nA --> B");
  await expect(dialog.getByRole("button", { name: "块内查找" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "显示 Mermaid 图形" }).click();
  await expect(dialog.locator(".mermaid-diagram-viewport svg")).toBeVisible();
});

test("手机 Mermaid 弹层支持双指缩放和单指拖动", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "触摸事件通过 Chromium CDP 注入");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.locator(".note-editor .ProseMirror")).toBeEditable();
    await page.locator(".note-editor .ProseMirror").evaluate(element => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      editor.commands.setContent({ type: "doc", content: [{
        type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\nA --> B" }],
      }] }, true);
    });
    const inline = page.locator(".note-editor .mermaid-diagram");
    await expect(inline.locator("svg")).toBeVisible();
    const inlineBox = (await inline.boundingBox())!;
    const inlineId = await inline.locator("svg").getAttribute("id");
    const inlineCdp = await context.newCDPSession(page);
    const ix = inlineBox.x + inlineBox.width / 2, iy = inlineBox.y + inlineBox.height / 2;
    await inlineCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: ix - 25, y: iy }, { id: 2, x: ix + 25, y: iy }] });
    await inlineCdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: ix - 60, y: iy }, { id: 2, x: ix + 60, y: iy }] });
    await inlineCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const inlineControls = page.locator(".note-editor [data-mermaid-controls]");
    await expect.poll(async () => parseInt((await inlineControls.getByRole("status").textContent())!)).toBeGreaterThan(100);
    expect(await inline.locator("svg").getAttribute("id")).toBe(inlineId);
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    const savedScale = await inlineControls.getByRole("status").textContent();
    await page.getByRole("button", { name: "折叠代码块", exact: true }).click();
    await expect(inline).toBeHidden();
    await page.getByRole("button", { name: "展开代码块", exact: true }).click();
    await expect(inline.locator("svg")).toBeVisible();
    expect(await inline.locator("svg").getAttribute("id")).toBe(inlineId);
    await expect(inlineControls.getByRole("status")).toHaveText(savedScale!);
    await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
    const viewport = page.getByRole("dialog", { name: "图像工作区" }).locator(".mermaid-diagram-viewport");
    await expect(viewport.locator("svg")).toBeVisible();
    const box = (await viewport.boundingBox())!;
    expect(box.height).toBeGreaterThan(250);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ id: number; x: number; y: number }>) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }]);
    await touch("touchMove", [{ id: 1, x: x - 75, y }, { id: 2, x: x + 75, y }]);
    await touch("touchEnd", []);
    const canvas = viewport.locator(".mermaid-diagram-canvas");
    await expect.poll(async () => Number((await page.getByRole("dialog", { name: "图像工作区" }).locator(".mermaid-diagram-controls [role=status]").textContent())?.replace("%", ""))).toBeGreaterThan(100);
    const beforePan = await canvas.getAttribute("style");
    await touch("touchStart", [{ id: 3, x, y }]);
    await touch("touchMove", [{ id: 3, x: x + 60, y: y + 35 }]);
    await touch("touchEnd", []);
    await expect(canvas).not.toHaveAttribute("style", beforePan!);
  } finally {
    await context.close();
  }
});


test("Mermaid 自定义颜色与多行标签在主题切换后保持完整", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" },
      content: [{ type: "text", text: 'flowchart TD\nA["现象<br/>间歇性失败"] --> B["检查"] --> C["结束"]\nstyle A fill:#ffdddd\nstyle B fill:#ffffcc\nstyle C fill:#ddd' }],
    }] }, true);
  });
  const diagram = page.locator(".note-editor .mermaid-diagram");
  await expect(diagram.locator("svg .node")).toHaveCount(3);
  await expect(diagram).not.toContainText("This page contains");
  await expect(diagram.locator("parsererror")).toHaveCount(0);
  await expect(diagram).toContainText("间歇性失败");
  const before = await diagram.locator("svg").getAttribute("id");
  const colors = () => diagram.locator(".node").evaluateAll(nodes => nodes.map(node => ({
    fill: getComputedStyle(node.querySelector("rect")!).fill,
    text: getComputedStyle(node.querySelector(".nodeLabel")!).color,
  })));
  const original = await colors();
  expect(original[0].fill).toBe("rgb(255, 221, 221)");
  expect(original[0].text).toBe("rgb(32, 33, 36)");
  await page.evaluate(() => { document.documentElement.className = "theme-azure-dark"; });
  await expect(diagram).toHaveCSS("background-color", "rgb(11, 21, 36)");
  expect(await colors()).toEqual(original);
  await expect(diagram.locator("svg")).toHaveAttribute("id", before!);
  await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
  const workspace = page.getByRole("dialog", { name: "图像工作区" });
  await expect(workspace.locator("svg .node")).toHaveCount(3);
  await expect(workspace.locator(".mermaid-diagram")).toHaveCSS("background-color", "rgb(11, 21, 36)");
});

test("多行分组标题与跨分组连线标签不被图形遮挡", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".note-editor .ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [{
      type: "codeBlock", attrs: { language: "mermaid" },
      content: [{ type: "text", text: 'flowchart LR\nsubgraph K["内核态 / Kernel Space<br/>绕过内核网络栈"]\n A["kernel networking stack<br/>largely bypassed"]\nend\nsubgraph S["Scale"]\n B["clusters"] --> C["Elastic IPs"]\nend\nsubgraph N["NIC 硬件层"]\n D["RX Queue"] --> E["Offload Boundary"]\nend\nS -.->|集群上下文| N' }],
    }] }, true);
  });
  const diagram = page.locator(".note-editor .mermaid-diagram");
  await expect(diagram.locator("svg .cluster")).toHaveCount(3);
  const checkCollisions = (target: typeof diagram) => target.evaluate(root => {
    const overlap = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const nodes = [...root.querySelectorAll(".node .label-container")].map(node => node.getBoundingClientRect());
    const titles = [...root.querySelectorAll(".cluster-label")];
    const clusters = [...root.querySelectorAll(".cluster > rect")].map(node => node.getBoundingClientRect());
    const edges = [...root.querySelectorAll(".edgeLabel .label")];
    return [
      ...titles.filter(title => nodes.some(node => overlap(title.getBoundingClientRect(), node))),
      ...edges.filter(label => clusters.some(cluster => overlap(label.getBoundingClientRect(), cluster))),
    ].map(label => label.textContent);
  });
  expect(await checkCollisions(diagram)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".sidebar-overlay.active").click({ position: { x: 380, y: 400 } });
  await page.locator(".note-editor .code-block-wrap").getByRole("button", { name: "放大阅读代码块" }).click();
  const workspace = page.getByRole("dialog", { name: "图像工作区" });
  await expect(workspace.locator("svg .cluster")).toHaveCount(3);
  const viewport = workspace.locator(".mermaid-diagram-viewport");
  await viewport.dispatchEvent("wheel", { deltaY: -100 });
  for (let step = 0; step < 32; step++) {
    await viewport.dispatchEvent("wheel", { deltaY: -100 });
  }
  await expect(workspace.locator(".mermaid-diagram-controls [role=status]")).toHaveText("500%");
  expect(await checkCollisions(workspace)).toEqual([]);
});
