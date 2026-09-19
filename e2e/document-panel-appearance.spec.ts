import { expect, test } from "@playwright/test";

for (const virtual of [false, true]) {
  test(`阅读面板统一样式、按完整条目加宽且不超过正文区域一半 ${virtual ? "局部只读" : "编辑"}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async (virtual) => {
      const load = (path: string) =>
        import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
      const { api } = await load("/src/lib/api.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { setReadonlyRenderingEnabled } = await load(
        "/src/lib/readonly-rendering.ts",
      );
      const content = mdToDelta(
        Array.from(
          { length: 220 },
          (_, i) =>
            `# ${i === 219 ? "这是最后一个很长的目录条目，用来验证虚拟列表之外的内容也能决定面板宽度。".repeat(3) : `章节 ${i}`}\n\n正文`,
        ).join("\n\n"),
      );
      content.metadata = {
        bookmarks: [
          {
            id: "long-bookmark",
            position: 1,
            preview:
              "很长的书签文字需要完整测量，且不能挤占正文的大部分宽度。".repeat(
                3,
              ),
            createdAt: new Date().toISOString(),
          },
        ],
      };
      const note = await api.notes.create({
        title: "面板外观",
        date: useNotesStore.getState().currentDate,
        storagePath: "tests",
        content,
      });
      useNotesStore
        .getState()
        .selectNote(
          virtual ? await api.notes.update(note.id, { readonly: true }) : note,
        );
      setReadonlyRenderingEnabled(virtual);
    }, virtual);
    await expect(
      page.locator(virtual ? ".vr-title" : ".note-title"),
    ).toBeVisible();
    const editor = page.locator(".note-editor");
    const triggers = [
      page.getByRole("button", { name: "文档目录", exact: true }),
      page.getByRole("button", { name: "文档书签", exact: true }),
    ];
    for (const trigger of triggers) {
      await trigger.hover();
      const panel = page.locator("[data-document-preview]");
      await expect(panel).toBeVisible();
      await expect
        .poll(async () => (await panel.boundingBox())!.width)
        .toBeGreaterThan(420);
      expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(
        (await editor.boundingBox())!.width / 2 + 1,
      );
      await page.mouse.move(5, 5);
      await expect(panel).toHaveCount(0);
    }
    for (const trigger of triggers) await trigger.click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    const handle = dock.getByRole("separator", { name: "调整阅读面板宽度" });
    const initial = (await dock.boundingBox())!;
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 80);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.width / 2 + initial.width - 320,
      grip.y + 80,
      {
        steps: 6,
      },
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await dock.boundingBox())!.width)
      .toBeCloseTo(320, 0);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("nr:workspaceLayout")!).panelWidth,
      ),
    ).toBeCloseTo(320, 0);
    for (const theme of ["light", "dark", "nord"]) {
      await page.evaluate((theme) => {
        document.documentElement.className = `theme-${theme}`;
      }, theme);
      const surfaces = await dock
        .locator(".document-panel-slot > *")
        .evaluateAll((elements) =>
          elements.map((el) => {
            const style = getComputedStyle(el);
            const probe = document.createElement("span");
            probe.style.background = "var(--bg)";
            el.appendChild(probe);
            const bg = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
              bg: style.backgroundColor,
              expected: bg,
              font: style.fontFamily,
              size: style.fontSize,
              color: style.color,
            };
          }),
        );
      expect(surfaces[0]).toEqual(surfaces[1]);
      expect(surfaces[0].bg).toBe(surfaces[0].expected);
      const texts = await dock
        .locator(
          virtual
            ? ".vr-outline-row button:last-child, .vr-bookmark"
            : ".document-outline-text, .document-bookmark-jump span:last-child",
        )
        .evaluateAll((elements) =>
          elements.map((el) => {
            const style = getComputedStyle(el);
            return {
              font: style.fontFamily,
              size: style.fontSize,
              weight: style.fontWeight,
              lineHeight: style.lineHeight,
              clamp: style.webkitLineClamp,
            };
          }),
        );
      expect(texts.at(-1)).toEqual(texts[0]);
    }
    await page.screenshot({ path: testInfo.outputPath("matching-panels.png") });
    for (const width of [1060, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(
          async () =>
            (await dock.boundingBox())!.width -
            (await editor.boundingBox())!.width / 2,
        )
        .toBeLessThanOrEqual(1);
      // A very wide saved preference must still obey the actual editor bounds.
      await page.evaluate(async () => {
        const path = "/src/lib/workspace-layout.ts";
        const { saveWorkspaceLayout } = await import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
        saveWorkspaceLayout({ panelWidth: 600 });
      });
      await expect
        .poll(
          async () =>
            (await dock.boundingBox())!.width -
            (await editor.boundingBox())!.width / 2,
        )
        .toBeLessThanOrEqual(1);
    }
    const lastGrip = (await handle.boundingBox())!;
    await page.mouse.move(lastGrip.x + lastGrip.width / 2, lastGrip.y + 80);
    await page.mouse.down();
    await page.mouse.move(10, lastGrip.y + 80, { steps: 6 });
    await page.mouse.up();
    expect((await dock.boundingBox())!.width).toBeLessThanOrEqual(
      (await editor.boundingBox())!.width / 2 + 1,
    );
  });
}
