import { expect, test } from "@playwright/test";
for (const enabled of [false, true])
  test(`展陈全屏外围信息悬停显示：${enabled ? "开启" : "默认关闭"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((enabled) => {
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "mono-aware",
          workspace_layout: "exhibition",
        }),
      );
      localStorage.setItem(
        "nr:workspaceLayout",
        JSON.stringify({ fullscreenQuietChrome: enabled }),
      );
      let fullscreen: Element | null = null;
      Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
      // Model a cancellable WebView default; a browser's reserved Escape is not
      // controlled by the page. Test with real keyboard events, not dispatch only.
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          setTimeout(() => {
            if (!event.defaultPrevented && fullscreen) {
              fullscreen = null;
              document.dispatchEvent(new Event("fullscreenchange"));
            }
          }, 0);
        },
        true,
      );
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
    }, enabled);
    await page.goto("/");
    await expect(page.locator(".ProseMirror:visible")).toBeVisible();
    const header = page.locator(".exhibition-masthead"),
      footer = page.locator(".exhibition-overview"),
      editor = page.locator(".note-editor-scroll:visible");
    await expect(header).toHaveCSS("opacity", "1");
    const before = await editor.boundingBox();
    await header.getByRole("button", { name: "进入全屏", exact: true }).click();
    const box = (await editor.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(header).toHaveCSS("opacity", enabled ? "0" : "1");
    await expect(footer).toHaveCSS("opacity", enabled ? "0" : "1");
    expect(await editor.boundingBox()).toEqual(before);
    const top = (await header.boundingBox())!;
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await expect(header).toHaveCSS("opacity", "1");
    const bottom = (await footer.boundingBox())!;
    await page.mouse.move(bottom.x + 20, bottom.y + bottom.height / 2);
    await expect(footer).toHaveCSS("opacity", "1");
    if (enabled) await expect(header).toHaveCSS("opacity", "0");
    if (enabled) {
      await footer
        .getByRole("button", { name: "展开概览", exact: true })
        .click();
      await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
      await expect(footer).toHaveCSS("opacity", "1");
      await footer
        .getByRole("button", { name: "收起概览", exact: true })
        .click();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await expect(footer).toHaveCSS("opacity", "0");
    }
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await header.getByRole("button", { name: "返回工作区首页", exact: true }).click();
    await page.mouse.move(640, 400);
    await expect(footer).toHaveCSS("opacity", enabled ? "0" : "1");
    if (enabled) {
      const homeBottom = (await footer.boundingBox())!;
      await page.mouse.move(homeBottom.x + 20, homeBottom.y + homeBottom.height / 2);
      await expect(footer).toHaveCSS("opacity", "1");
      await footer.getByRole("button", { name: "展开概览", exact: true }).click();
      await page.mouse.move(640, 400);
      await expect(footer).toHaveCSS("opacity", "1");
      await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
      await header.getByRole("button", { name: "返回上一页面", exact: true }).click();
      await header.getByRole("button", { name: "返回工作区首页", exact: true }).click();
      await page.mouse.move(640, 400);
      await expect(footer).toHaveCSS("opacity", "0");
    }
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await header.getByRole("button", { name: "退出全屏", exact: true }).click();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(header).toHaveCSS("opacity", "1");
    await expect(footer).toHaveCSS("opacity", "1");
  });

test("全屏显示开关从布局设置保存，重载后仍保留", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await page.getByRole("button", { name: /布局设置.*打开布局设置/ }).click();
  const checkbox = page.getByRole("checkbox", {
    name: "悬停显示外围信息",
    exact: true,
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nr:workspaceLayout")!)
          .fullscreenQuietChrome,
    ),
  ).toBe(true);
  const scopes = page.getByRole("group", {
    name: "外围信息悬停显示范围",
    exact: true,
  });
  await expect(
    scopes.getByRole("radio", { name: "仅全屏开启", exact: true }),
  ).toBeChecked();
  await scopes.getByRole("radio", { name: "始终开启", exact: true }).check();
  await scopes
    .getByRole("radio", { name: "仅非全屏开启", exact: true })
    .check();
  await expect(scopes.locator("input:checked")).toHaveCount(1);
  await page.reload();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nr:workspaceLayout")!)
          .fullscreenQuietChrome,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("nr:workspaceLayout")!)
          .quietChromeScope,
    ),
  ).toBe("windowed");
});

for (const scope of ["always", "fullscreen", "windowed"] as const)
  test(`外围信息显示范围互斥：${scope}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.evaluate(async (scope) => {
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "mono-aware",
          workspace_layout: "exhibition",
        }),
      );
      localStorage.setItem(
        "nr:workspaceLayout",
        JSON.stringify({
          fullscreenQuietChrome: true,
          quietChromeScope: scope,
        }),
      );
    }, scope);
    // Reuse the same fullscreen API mock as the interaction tests.
    await page.addInitScript(() => {
      let full: Element | null = null;
      Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
      Object.defineProperty(document, "fullscreenElement", { get: () => full });
      Element.prototype.requestFullscreen = async () => {
        full = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
      document.exitFullscreen = async () => {
        full = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
    });
    await page.reload();
    await expect(page.locator(".ProseMirror:visible")).toBeVisible();
    const header = page.locator(".exhibition-masthead"),
      overview = page.locator(".exhibition-overview");
    const center = async () => {
      const b = (await page
        .locator(".note-editor-scroll:visible")
        .boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    };
    await center();
    await expect(header).toHaveCSS(
      "opacity",
      scope === "fullscreen" ? "1" : "0",
    );
    await expect(overview).toHaveCSS(
      "opacity",
      scope === "fullscreen" ? "1" : "0",
    );
    await header.hover();
    await header.getByRole("button", { name: "进入全屏", exact: true }).click();
    await center();
    await expect(header).toHaveCSS("opacity", scope === "windowed" ? "1" : "0");
    await expect(overview).toHaveCSS(
      "opacity",
      scope === "windowed" ? "1" : "0",
    );
    await header.hover();
    await header.getByRole("button", { name: "退出全屏", exact: true }).click();
    await center();
    await expect(header).toHaveCSS(
      "opacity",
      scope === "fullscreen" ? "1" : "0",
    );
  });

test("Esc closes settings without leaving fullscreen and remains available to later menus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        interface_style: "mono-aware",
        workspace_layout: "exhibition",
      }),
    );
    let full: Element | null = null;
    Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
    Object.defineProperty(document, "fullscreenElement", { get: () => full });
    Element.prototype.requestFullscreen = async () => {
      full = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    document.exitFullscreen = async () => {
      full = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape")
          setTimeout(() => {
            if (!event.defaultPrevented) {
              full = null;
              document.dispatchEvent(new Event("fullscreenchange"));
            }
          }, 0);
      },
      true,
    );
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  await page.getByRole("button", { name: "进入全屏", exact: true }).click();
  await page.getByTitle("设置", { exact: true }).click();
  await expect(page.locator(".settings-panel")).toBeVisible();
  await page.getByRole("button", { name: "打开设置查找", exact: true }).click();
  await page
    .getByRole("textbox", { name: "查找设置", exact: true })
    .fill("布局");
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-panel")).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "退出全屏", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  await page.evaluate(() => {
    (window as any).__lateEscape = false;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          (window as any).__lateEscape = true;
          event.preventDefault();
        }
      },
      { once: true },
    );
  });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).__lateEscape)).toBe(true);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "新建文档", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "新建文档", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
});

for (const readonly of [false, true])
  test(`上下悬停往返保留固定目录和状态栏：只读=${readonly}`, async ({
    page,
  }) => {
    const { createBlankDocument } = await import("./helpers/document");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((readonly) => {
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "mono-aware",
          workspace_layout: "exhibition",
          editor_show_status_bar: true,
        }),
      );
      localStorage.setItem(
        "nr:workspaceLayout",
        JSON.stringify({
          fullscreenQuietChrome: true,
          quietChromeScope: readonly ? "fullscreen" : "always",
          outlinePinned: true,
        }),
      );
      let full: Element | null = null;
      Object.defineProperty(document, "fullscreenEnabled", { get: () => true });
      Object.defineProperty(document, "fullscreenElement", { get: () => full });
      Element.prototype.requestFullscreen = async () => {
        full = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
      document.exitFullscreen = async () => {
        full = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
    }, readonly);
    await createBlankDocument(page, "悬停绘制连续性");
    await page.locator(".ProseMirror:visible").evaluate((element) =>
      (element as any).editor.commands.setContent(
        {
          type: "doc",
          content: Array.from({ length: 40 }, (_, i) => [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: `章节 ${i}` }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "正文用于检查阅读位置和面板连续性。".repeat(6),
                },
              ],
            },
          ]).flat(),
        },
        true,
      ),
    );
    if (readonly)
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
    if (readonly)
      await page.getByRole("button", { name: "进入全屏", exact: true }).click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" }),
      status = page.locator(".editor-stats:visible"),
      root = page.locator(".note-editor-scroll:visible");
    await expect(dock).toBeVisible();
    await expect(status).toBeVisible();
    await root.hover();
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => root.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    // Finish the actual wheel/fullscreen settling before observing hover alone.
    await root.evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          let previous = el.scrollTop,
            stable = 0;
          const frame = () => {
            const next = el.scrollTop;
            stable = Math.abs(next - previous) < 0.5 ? stable + 1 : 0;
            previous = next;
            if (stable >= 5) resolve();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
    );
    await page.evaluate(() => {
      const nodes = [
        document.querySelector(".document-panel-dock")!,
        document.querySelector(".editor-stats")!,
        document.querySelector(".note-editor-scroll")!,
      ];
      const initial = nodes.map((el) => {
        const b = el.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height];
      });
      const scroll = nodes[2].scrollTop;
      const state = { frames: 0, failures: [] as string[], stop: false };
      (window as any).__hoverMonitor = state;
      const sample = () => {
        if (state.stop) return;
        state.frames++;
        nodes.forEach((el, i) => {
          const b = el.getBoundingClientRect(),
            css = getComputedStyle(el);
          if (
            !el.isConnected ||
            css.display === "none" ||
            css.visibility === "hidden" ||
            Number(css.opacity) !== 1
          )
            state.failures.push(`hidden ${i}`);
          if (
            [b.x, b.y, b.width, b.height].some(
              (n, j) => Math.abs(n - initial[i][j]) > 0.5,
            )
          )
            state.failures.push(`layout ${i}`);
        });
        if (Math.abs(nodes[2].scrollTop - scroll) > 1)
          state.failures.push("scroll");
        requestAnimationFrame(sample);
      };
      sample();
    });
    const header = page.locator(".exhibition-masthead"),
      overview = page.locator(".exhibition-overview");
    for (let i = 0; i < 3; i++) {
      await overview.hover({ position: { x: 20, y: 12 } });
      await expect(overview).toHaveCSS("opacity", "1");
      await header.hover({ position: { x: 20, y: 15 } });
      await expect(header).toHaveCSS("opacity", "1");
      await expect(overview).toHaveCSS("opacity", "0");
      await expect(header).toHaveCSS("will-change", "opacity");
      await expect(overview).toHaveCSS("will-change", "opacity");
    }
    const result = await page.evaluate(() => {
      const s = (window as any).__hoverMonitor;
      s.stop = true;
      return { frames: s.frames, failures: s.failures };
    });
    expect(result.frames).toBeGreaterThan(10);
    expect(result.failures).toEqual([]);
  });
