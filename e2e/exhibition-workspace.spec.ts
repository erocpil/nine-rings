import { expect, test } from "@playwright/test";

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
    await expect(page.locator(".exhibition-masthead")).toBeVisible();
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
      path: `/tmp/nr-exhibition-${style}-home.png`,
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
    await page.getByLabel("工作区风格").selectOption("yugen");
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-style",
      "yugen",
    );
    await page.getByLabel("工作区配色").selectOption("dark");
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
      path: `/tmp/nr-exhibition-${style}-mobile.png`,
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
  await page.getByLabel("文本宽度", { exact: true }).selectOption("narrow");
  await expect(content).toHaveCSS("max-width", "690px");
  const narrow = (await content.boundingBox())!.width;
  await page.getByLabel("文本宽度", { exact: true }).selectOption("standard");
  const standard = (await content.boundingBox())!.width;
  expect(standard).toBeGreaterThan(narrow);
  await page.getByLabel("文本宽度", { exact: true }).selectOption("wide");
  await expect(content).toHaveCSS("max-width", "100%");
  const wide = (await content.boundingBox())!.width;
  expect(Math.abs(standard - (narrow + wide) / 2)).toBeLessThan(1);
  await page.setViewportSize({ width: 1800, height: 1000 });
  const resizedWide = (await content.boundingBox())!.width;
  await page.getByLabel("文本宽度", { exact: true }).selectOption("narrow");
  const resizedNarrow = (await content.boundingBox())!.width;
  await page.getByLabel("文本宽度", { exact: true }).selectOption("standard");
  await expect.poll(async () => Math.abs((await content.boundingBox())!.width - (resizedNarrow + resizedWide) / 2)).toBeLessThan(1);
  await page.getByLabel("文本宽度", { exact: true }).selectOption("wide");
  await page.getByLabel("紧凑程度", { exact: true }).selectOption("compact");
  await expect(header).toHaveCSS("height", "42px");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm",
  );
  await page.reload();
  await expect(page.getByLabel("文本宽度", { exact: true })).toHaveValue(
    "wide",
  );
  await expect(page.getByLabel("紧凑程度", { exact: true })).toHaveValue(
    "compact",
  );
  await page
    .getByLabel("紧凑程度", { exact: true })
    .selectOption("comfortable");
  await expect(header).toHaveCSS("height", "48px");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.locator(".titlebar-wordmark")).toHaveText("NINE RINGS");
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
  await page.screenshot({ path: "/tmp/nr-exhibition-controls-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("文本宽度", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("紧凑程度", { exact: true })).toHaveCount(0);
  await expect(page.locator(".exhibition-shell[data-density]")).toHaveCount(0);
  await expect(page.locator(".exhibition-shell[data-text-width]")).toHaveCount(
    0,
  );
});
