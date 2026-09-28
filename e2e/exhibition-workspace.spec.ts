import { expect, test, type Page } from "@playwright/test";
import { createEpubFixture, createPdfFixture } from "./helpers/reader-fixtures";

async function selectAppearance(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("listbox", { name: label, exact: true }).locator(`[role="option"][value="${value}"]`).click();
}


for (const style of ["calm", "mono-aware"] as const) {
  test(`${style} 展陈工作区首页、文档与专注布局`, async ({ page }) => {
    await page.addInitScript((style) => {
      const config = JSON.parse(
        localStorage.getItem("nine_rings_config") || "{}",
      );
      if (!config.workspace_layout)
        localStorage.setItem(
          "nine_rings_config",
          JSON.stringify({
            ...config,
            interface_style: style,
            workspace_layout: "exhibition",
            interface_color_mode: "light",
          }),
        );
    }, style);
    await page.goto("/");
    const sample = page.getByRole("button", {
      name: "物哀、幽玄与侘寂：风格设计与验证",
      exact: true,
    });
    await expect(sample).toBeVisible();
    await sample.click();
    await expect(page.locator(".note-title")).toHaveValue("物哀、幽玄与侘寂：风格设计与验证");
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
    const framedApp = page.locator(".is-exhibition > .app");
    await expect(framedApp).toHaveCSS("overflow", "hidden");
    await expect(framedApp).toHaveCSS("border-top-left-radius", "10px");
    await expect(framedApp).toHaveCSS("border-bottom-left-radius", "10px");
    await expect(framedApp).toHaveCSS("border-top-right-radius", "10px");
    await expect(framedApp).toHaveCSS("border-bottom-right-radius", "10px");
    await expect(
      page.locator(".exhibition-masthead .titlebar-title"),
    ).toHaveCount(0);
    await expect(page.locator(".exhibition-identity > span")).toHaveText(
      "NINE RINGS / WORKSPACE",
    );
    await expect(page.locator(".app > .titlebar")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "关闭", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "展开概览", exact: true }),
    ).toBeVisible();
    await page
      .locator(".note-editor .ProseMirror")
      .fill("展陈布局切换前的编辑应当保存。");
    await page.getByRole("button", { name: "返回工作区首页" }).click();
    await expect(page.locator(".exhibition-welcome")).toBeVisible();
    const activityBar = page.locator(".desktop-activity-bar");
    await expect(activityBar).toHaveCSS("opacity", "0");
    await activityBar.hover();
    await expect(activityBar).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue("物哀、幽玄与侘寂：风格设计与验证");
    await expect(page.locator(".note-editor .ProseMirror")).toContainText("展陈布局切换前的编辑应当保存。");
    await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
    await expect(page.locator(".exhibition-welcome")).toBeVisible();
    await expect(page.locator(".exhibition-columns > section")).toHaveCount(4);
    await expect(
      page
        .locator(".exhibition-columns")
        .getByRole("button", {
          name: "物哀、幽玄与侘寂：风格设计与验证",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`nr-exhibition-${style}-home.png`),
      animations: "disabled",
    });
    await page
      .locator(".exhibition-columns")
      .getByRole("button", {
        name: "物哀、幽玄与侘寂：风格设计与验证",
        exact: true,
      })
      .first()
      .click();
    await expect(page.locator(".note-title")).toHaveValue(
      "物哀、幽玄与侘寂：风格设计与验证",
    );
    await expect(page.locator(".exhibition-columns")).toHaveCount(0);
    await expect(page.locator(".note-editor .ProseMirror")).toContainText(
      "展陈布局切换前的编辑应当保存。",
    );
    await selectAppearance(page, "工作区风格", "yugen");
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-style",
      "yugen",
    );
    await selectAppearance(page, "工作区配色", "dark");
    await page.reload();
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await page.getByRole("button", { name: "专注模式", exact: true }).click();
    await expect(page.locator(".exhibition-masthead")).toHaveCount(0);
    await page.getByRole("button", { name: /退出专注/ }).click();
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const overlay = page.locator(".sidebar-overlay.active");
    if (await overlay.isVisible())
      await overlay.click({ position: { x: 380, y: 400 } });
    await page.getByRole("button", { name: "展开概览", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(page.locator(".exhibition-columns")).toHaveCSS(
      "grid-template-columns",
      /^(\d+(\.\d+)?px)$/,
    );
    await page.screenshot({
      path: test.info().outputPath(`nr-exhibition-${style}-mobile.png`),
      animations: "disabled",
    });
  });
}

test("布局设置可切换，经典暂时停用且保留展陈选择", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        interface_style: "calm",
        workspace_layout: "exhibition",
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".exhibition-masthead")).toBeVisible();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const layout = page.getByRole("group", { name: "工作区布局", exact: true });
  await expect(
    layout.getByRole("button", { name: "展陈", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const styles = page.getByRole("group", { name: "界面风格", exact: true });
  await styles.getByRole("button", { name: /^经典/ }).click();
  await expect(page.locator(".exhibition-masthead")).toHaveCount(0);
  await expect(
    layout.getByRole("button", { name: "展陈", exact: true }),
  ).toBeDisabled();
  await styles.getByRole("button", { name: /^纸页/ }).click();
  await expect(page.locator(".exhibition-masthead")).toBeVisible();
  await layout.getByRole("button", { name: "标准", exact: true }).click();
  await expect(page.locator(".exhibition-masthead")).toHaveCount(0);
});

test("Web 展陈全屏按钮同步进入与退出状态", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        interface_style: "calm",
        workspace_layout: "exhibition",
      }),
    );
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
    Object.defineProperty(document, "fullscreenElement", {
      get: () => fullscreen,
    });
    Element.prototype.requestFullscreen = async () => {
      fullscreen = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    document.exitFullscreen = async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
  });
  await page.goto("/");
  const header = page.locator(".exhibition-masthead");
  await header.getByRole("button", { name: "进入全屏", exact: true }).click();
  await expect(
    header.getByRole("button", { name: "退出全屏", exact: true }),
  ).toBeVisible();
  await header.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(
    header.getByRole("button", { name: "进入全屏", exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("button", { name: "关闭", exact: true }),
  ).toHaveCount(0);
});

test("桌面展陈宽度和密度独立持久化，手机保持原布局", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("nine_rings_config"))
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "calm",
          workspace_layout: "exhibition",
        }),
      );
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "物哀、幽玄与侘寂：风格设计与验证",
      exact: true,
    })
    .click();
  const content = page.locator(".note-editor-scroll > .editor-content-shell");
  const header = page.locator(".note-title-row");
  await selectAppearance(page, "文本宽度", "narrow");
  await expect(content).toHaveCSS("max-width", "690px");
  const narrow = (await content.boundingBox())!.width;
  await selectAppearance(page, "文本宽度", "standard");
  const standard = (await content.boundingBox())!.width;
  expect(standard).toBeGreaterThan(narrow);
  await selectAppearance(page, "文本宽度", "wide");
  await expect(content).toHaveCSS("max-width", "100%");
  const wide = (await content.boundingBox())!.width;
  expect(Math.abs(standard - (narrow + wide) / 2)).toBeLessThan(1);
  await page.setViewportSize({ width: 1800, height: 1000 });
  const resizedWide = (await content.boundingBox())!.width;
  await selectAppearance(page, "文本宽度", "narrow");
  const resizedNarrow = (await content.boundingBox())!.width;
  await selectAppearance(page, "文本宽度", "standard");
  await expect.poll(async () => Math.abs((await content.boundingBox())!.width - (resizedNarrow + resizedWide) / 2)).toBeLessThan(1);
  await selectAppearance(page, "文本宽度", "wide");
  await selectAppearance(page, "紧凑程度", "compact");
  await expect(header).toHaveCSS("height", "42px");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm",
  );
  await page.reload();
  await expect(page.getByLabel("文本宽度", { exact: true })).toHaveAttribute("data-value",
    "wide",
  );
  await expect(page.getByLabel("紧凑程度", { exact: true })).toHaveAttribute("data-value",
    "compact",
  );
  await selectAppearance(page, "紧凑程度", "comfortable");
  await expect(header).toHaveCSS("height", "48px");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.locator(".titlebar-wordmark")).toHaveText("NINE RINGS");
  await expect(page.locator(".titlebar-wordmark")).toHaveCSS("font-size", "10.5px");
  await expect(page.locator(".titlebar-logo")).toHaveCount(0);
  await expect(page.locator(".titlebar-wordmark > span").first()).toHaveCSS(
    "font-size",
    "14px",
  );
  await page.getByRole("button", { name: /退出专注/ }).click();
  await expect.poll(async () => {
    const leading = await page.locator(".titlebar-leading").boundingBox();
    const workspace = await page.locator(".titlebar-workspace").boundingBox();
    return leading!.width - workspace!.width;
  }).toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath("nr-exhibition-controls-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("文本宽度", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("紧凑程度", { exact: true })).toHaveCount(0);
  await expect(page.locator(".exhibition-shell[data-density]")).toHaveCount(0);
  await expect(page.locator(".exhibition-shell[data-text-width]")).toHaveCount(
    0,
  );
});

test("风格默认浅色宽幅舒适，非经典风格共享侘寂排版", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({
    interface_style: "calm",
    workspace_layout: "exhibition",
  })));
  await page.goto("/");
  const shell = page.locator(".exhibition-shell");
  await expect(shell).toHaveAttribute("data-text-width", "wide");
  await expect(shell).toHaveAttribute("data-density", "comfortable");
  await expect(page.locator("html")).toHaveClass(/theme-light/);

  const editor = page.locator(".note-editor .ProseMirror");
  const typography = async () => editor.evaluate(element => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily };
  });
  const baseline = await typography();
  expect(baseline.fontSize).toBe("16px");
  expect(Number.parseFloat(baseline.lineHeight)).toBeCloseTo(28.8, 1);
  expect(baseline.fontFamily).toMatch(/serif/i);
  for (const style of ["paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
    await selectAppearance(page, "工作区风格", style);
    await expect.poll(typography).toEqual(baseline);
  }
});


test("桌面顶部菜单一次点击切换，取消不修改配置，手机仍为原生选择", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "nine-rings", interface_color_mode: "light", workspace_layout: "exhibition" })));
  await page.goto("/");
  const before = await page.evaluate(() => localStorage.getItem("nine_rings_config"));
  for (const label of ["工作区风格", "工作区配色", "文本宽度", "紧凑程度", "工作区风格"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(1);
    await expect(page.getByRole("listbox", { name: label, exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "工作区风格", exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("nine_rings_config"))).toBe(before);
  await expect(page.getByRole("button", { name: "文本宽度", exact: true })).toHaveText("宽幅");
  await selectAppearance(page, "工作区配色", "dark");
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await page.getByRole("button", { name: "工作区风格", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator('select[aria-label="工作区风格"]')).toBeVisible();
});


test("首页快速往返不保存恢复期间的临时滚动位置", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" })));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: Array.from({length: 150}, (_, i) => ({type: "paragraph", content: [{type: "text", text: `第 ${i} 段：快速往返定位测试。`}]})) }, true);
  });
  await page.waitForTimeout(700);
  const target = await page.locator(".note-editor-scroll").evaluate(element => {
    element.scrollTop = 3000;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  expect(target).toBeGreaterThan(2000);
  await page.getByRole("button", {name: "返回工作区首页", exact: true}).click();
  // Simulate a slow NodeView: the target cannot be reached on initial mount.
  await page.addStyleTag({content: ".note-editor-scroll > .editor-content-shell { max-height: 150px !important; overflow: hidden !important; }"});
  await page.getByRole("button", {name: "返回上一页面", exact: true}).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator(".note-editor-scroll").evaluate(element => {
    // A queued native scroll notification may arrive after the height clamp.
    element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", {name: "返回工作区首页", exact: true}).click();
  await page.evaluate(() => { for (const style of document.querySelectorAll("style")) if (style.textContent?.includes("max-height: 150px !important")) style.remove(); });
  await page.getByRole("button", {name: "返回上一页面", exact: true}).click();
  await expect.poll(() => page.locator(".note-editor-scroll").evaluate(element => element.scrollTop)).toBeCloseTo(target, 0);
});

test("首页从固定阅读分栏打开 PDF 后收回空栏，返回时保留 PDF 阅读器", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" }));
    localStorage.setItem("nr:sidebarPresentation", "split");
    localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "reader", hidden: false, pinned: true }));
  });
  await page.goto("/");
  const title = page.locator(".note-title");
  await expect(title).toBeVisible();
  const originalTitle = await title.inputValue();
  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();

  await page.locator(".desktop-activity-bar").hover();
  await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).click();
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  await library.locator('input[accept="application/pdf,.pdf"]').setInputFiles({
    name: "home-reader.pdf", mimeType: "application/pdf", buffer: createPdfFixture(),
  });

  const reader = page.getByLabel("PDF 阅读器", { exact: true });
  const sidebar = page.locator(".app-sidebar");
  await expect(reader).toBeVisible();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await expect(page.locator(".sidebar-divider")).toHaveCount(0);

  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await expect(title).toHaveValue(originalTitle);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await expect(page.locator(".app-main").getByLabel("PDF 阅读器", { exact: true })).toBeVisible();
});

test("首页悬停阅读分栏打开 EPUB 后取消悬停并收回分栏", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" }));
    localStorage.setItem("nr:sidebarPresentation", "overlay");
    localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "reader", hidden: true, pinned: false }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();

  const activityBar = page.locator(".desktop-activity-bar");
  await activityBar.hover();
  await page.getByRole("button", { name: "PDF / EPUB 阅读", exact: true }).hover();
  const library = page.getByRole("region", { name: "阅读资料库", exact: true });
  await expect(library).toBeVisible();
  await library.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
    name: "home-reader.epub", mimeType: "application/epub+zip", buffer: createEpubFixture(),
  });

  const sidebar = page.locator(".app-sidebar");
  await expect(page.getByLabel("EPUB 阅读器", { exact: true })).toBeVisible();
  await page.mouse.move(850, 500);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await expect(page.locator(".sidebar-divider")).toHaveCount(0);
});

for (const presentation of ["overlay", "split"] as const) {
  for (const hidden of [false, true]) {
    test(`首页未打开文件返回恢复分栏：${presentation} hidden=${hidden}`, async ({ page }) => {
      await page.addInitScript(({ presentation, hidden }) => {
        localStorage.setItem("nine_rings_config", JSON.stringify({
          interface_style: "calm", workspace_layout: "exhibition",
        }));
        localStorage.setItem("nr:sidebarPresentation", presentation);
        localStorage.setItem("nr:desktopSidebar", JSON.stringify({
          panel: "tree", hidden, pinned: !hidden,
        }));
      }, { presentation, hidden });
      await page.goto("/");
      await expect(page.locator(".note-title")).toBeVisible();
      const sidebar = page.locator(".app-sidebar");
      const tree = page.locator('[data-sidebar-panel="tree"]');
      const assertRestored = async () => {
        await expect(tree).toHaveAttribute("aria-expanded", String(!hidden));
        if (presentation === "overlay" && !hidden)
          await expect(tree).toHaveAttribute("data-pinned", "true");
      };
      await assertRestored();
      for (const preview of [false, true]) {
        await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
        await expect(page.locator(".exhibition-welcome")).toBeVisible();
        await expect(sidebar).toHaveClass(/sidebar-hidden/);
        if (preview) {
          await page.locator(".desktop-activity-bar").hover();
          // Changing a panel on home without opening a document must not
          // replace the snapshot taken before home navigation.
          await page.locator('[data-sidebar-panel="reader"]').click();
          await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
        }
        await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
        await expect(page.locator(".note-title")).toBeVisible();
        await assertRestored();
        await page.mouse.move(1200, 650);
        // Observe past both the hover dismissal (180ms) and CSS transition.
        const states = await tree.evaluate(async element => {
          const values: (string | null)[] = [];
          const until = performance.now() + 600;
          while (performance.now() < until) {
            values.push(element.getAttribute("aria-expanded"));
            await new Promise(requestAnimationFrame);
          }
          return [...new Set(values)];
        });
        expect(states).toEqual([String(!hidden)]);
      }
    });
  }
}

for (const panel of ["tree", "list"] as const) {
  for (const entry of ["hover", "click"] as const) {
    test(`首页通过分栏打开文件后保留悬停或固定模式：${panel} ${entry}`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("nine_rings_config", JSON.stringify({
          interface_style: "calm", workspace_layout: "exhibition",
        }));
        localStorage.setItem("nr:sidebarPresentation", "overlay");
      });
      await page.goto("/");
      await expect(page.locator(".note-title")).toBeVisible();
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
        await api.notes.create({ title: "首页分栏打开验证", date: "2026-09-28", storagePath: "",
          content: { ops: [{ insert: "从首页打开文档后保持分栏。\n" }] } });
      });
      await page.reload();
      await expect(page.locator(".note-title")).toBeVisible();
      await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
      await expect(page.locator(".exhibition-welcome")).toBeVisible();
      await page.locator(".desktop-activity-bar").hover();
      const button = page.locator(`[data-sidebar-panel="${panel}"]`);
      if (entry === "hover") await button.hover();
      else await button.click();
      const sidebar = page.locator(".app-sidebar");
      if (panel === "list")
        await sidebar.getByRole("button", { name: "全部文档", exact: true }).click();
      await sidebar.getByRole("button", { name: "首页分栏打开验证", exact: true }).click();
      await expect(page.locator(".note-title")).toHaveValue("首页分栏打开验证");
      await expect(page.locator(".exhibition-welcome")).toBeHidden();
      if (entry === "click") await expect(button).toHaveAttribute("data-pinned", "true");
      else await expect(button).not.toHaveAttribute("data-pinned", "true");
      await page.mouse.move(1200, 650);
      // Leave the pane long enough for a hover preview's dismissal to fire.
      await page.waitForTimeout(600);
      await expect(button).toHaveAttribute("aria-expanded", String(entry === "click"));
      await expect(page.locator(".desktop-activity-bar")).toHaveCSS("opacity", "1");
      // A later home round trip preserves a pin, but never pins a preview.
      await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
      await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
      if (entry === "click") await expect(button).toHaveAttribute("data-pinned", "true");
      else await expect(button).not.toHaveAttribute("data-pinned", "true");
      await expect(button).toHaveAttribute("aria-expanded", String(entry === "click"));
      await expect(page.locator(".note-title")).toHaveValue("首页分栏打开验证");
    });
  }
}
