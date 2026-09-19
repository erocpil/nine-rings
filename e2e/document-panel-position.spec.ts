import { expect, test, type Locator, type Page } from "@playwright/test";

const cases = [
  { name: "Web 桌面", width: 1280, height: 800, virtual: false, platform: "" },
  {
    name: "Web 局部阅读",
    width: 1280,
    height: 800,
    virtual: true,
    platform: "",
  },
  {
    name: "Mac Tauri",
    width: 1280,
    height: 800,
    virtual: false,
    platform: "MacIntel",
  },
  {
    name: "Windows Tauri",
    width: 1280,
    height: 800,
    virtual: false,
    platform: "Win32",
  },
  {
    name: "Tauri 局部阅读",
    width: 1280,
    height: 800,
    virtual: true,
    platform: "MacIntel",
  },
  { name: "Web 手机", width: 390, height: 760, virtual: false, platform: "" },
  {
    name: "Web 手机局部阅读",
    width: 390,
    height: 760,
    virtual: true,
    platform: "",
  },
  {
    name: "Web 手机横屏",
    width: 844,
    height: 390,
    virtual: false,
    platform: "",
  },
];

async function fixture(page: Page, virtual: boolean, platform: string) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(
    async ({ virtual }) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { setReadonlyRenderingEnabled } = await load(
        "/src/lib/readonly-rendering.ts",
      );
      const content = mdToDelta(
        Array.from(
          { length: 28 },
          (_, i) => `# 第 ${i + 1} 节\n\n这一节的正文内容。`,
        ).join("\n\n"),
      );
      content.metadata = {
        bookmarks: [
          {
            id: "panel-test",
            position: 1,
            preview: "第 1 节",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      const note = await api.notes.create({
        title: "目录和书签定位",
        storagePath: "tests",
        content,
      });
      const selected = virtual
        ? await api.notes.update(note.id, { readonly: true })
        : note;
      useNotesStore.getState().selectNote(selected);
      setReadonlyRenderingEnabled(virtual);
    },
    { virtual },
  );
  await expect(
    page.locator(virtual ? ".vr-title" : ".note-title-row"),
  ).toBeVisible();
  if (platform) {
    // Window presentation only; keep the initialized browser storage adapter.
    await page.evaluate(async (platform) => {
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: platform,
      });
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { mockIPC, mockWindows } = await load(
        "/node_modules/@tauri-apps/api/mocks.js",
      );
      mockWindows("main");
      mockIPC(() => null, { shouldMockEvents: true });
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      useNotesStore.setState({
        selectedNote: { ...useNotesStore.getState().selectedNote },
      });
    }, platform);
    await expect(page.locator(".titlebar")).toBeVisible();
  }
}

async function expectAnchored(page: Page, trigger: Locator, panel: Locator) {
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => {
      const button = (await trigger.boundingBox())!;
      const popup = (await panel.boundingBox())!;
      return Math.abs(popup.y - button.y - button.height - 6);
    })
    .toBeLessThan(1);
  const popup = (await panel.boundingBox())!;
  const button = (await trigger.boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(7);
  expect(popup.x + popup.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 7,
  );
  expect(popup.y + popup.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 7,
  );
  const expectedLeft = Math.max(
    8,
    Math.min(
      button.x + button.width - popup.width,
      page.viewportSize()!.width - popup.width - 8,
    ),
  );
  expect(Math.abs(popup.x - expectedLeft)).toBeLessThan(1);
  expect(
    await trigger.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ),
      );
    }),
  ).toBe(true);
}

for (const item of cases) {
  test.describe(item.name, () => {
    test.use({
      viewport: { width: item.width, height: item.height },
      hasTouch: item.width < 1000,
    });
    test("目录和书签贴近按钮，普通与专注模式都不遮挡入口", async ({
      page,
    }, testInfo) => {
      await fixture(page, item.virtual, item.platform);
      const row = page.locator(item.virtual ? ".vr-title" : ".note-title-row");
      for (const focus of [false, true]) {
        if (focus)
          await row
            .getByRole("button", { name: "专注模式", exact: true })
            .click();
        for (const name of ["文档目录", "文档书签"]) {
          const trigger = row.getByRole("button", { name, exact: true });
          const panel = page.getByRole(item.virtual ? "region" : "navigation", {
            name,
            exact: true,
          });
          await trigger.click();
          await expectAnchored(page, trigger, panel);
          await page.locator(".note-editor-scroll").evaluate((element) => {
            element.scrollTop = 160;
          });
          await expectAnchored(page, trigger, panel);
          if (focus && name === "文档书签")
            await page.screenshot({
              path: testInfo.outputPath("bookmark-popover.png"),
            });
          await trigger.click();
          await expect(panel).toHaveCount(0);
        }
      }
      const trigger = row.getByRole("button", {
        name: "文档目录",
        exact: true,
      });
      await trigger.click();
      await page.setViewportSize({
        width: item.width >= 1000 ? 1060 : item.width,
        height: item.height - 60,
      });
      await expectAnchored(
        page,
        trigger,
        page.getByRole(item.virtual ? "region" : "navigation", {
          name: "文档目录",
          exact: true,
        }),
      );
    });
  });
}

test("按钮下方空间不足时向上展开，仍留出按钮间隔", async ({ page }) => {
  await fixture(page, false, "");
  const trigger = page.getByRole("button", { name: "文档书签", exact: true });
  await trigger.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: "fixed",
      bottom: "12px",
      right: "24px",
      zIndex: "71",
    });
  });
  await trigger.click();
  const panel = page.getByRole("navigation", { name: "文档书签", exact: true });
  await expect(panel).toBeVisible();
  await expect
    .poll(async () => {
      const button = (await trigger.boundingBox())!;
      const popup = (await panel.boundingBox())!;
      return Math.abs(button.y - popup.y - popup.height - 6);
    })
    .toBeLessThan(1);
  await trigger.click();
  await expect(panel).toHaveCount(0);
});

test("手动固定目录保留停靠，取消固定后回到按钮旁", async ({ page }) => {
  await fixture(page, false, "");
  const trigger = page.getByRole("button", { name: "文档目录", exact: true });
  await trigger.click();
  const panel = page.getByRole("navigation", { name: "文档目录", exact: true });
  await panel.getByTitle("固定目录到左侧").click();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-left/);
  await expect(panel).toHaveCSS("position", "absolute");
  await panel.getByTitle("取消固定目录").click();
  await expectAnchored(page, trigger, panel);
});
