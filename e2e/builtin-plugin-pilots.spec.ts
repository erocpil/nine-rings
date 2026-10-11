import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";
import {
  replaceSource,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";

for (const sourceMode of [false, true]) {
  test(`内置日期插件插入保存、单步撤销与统计实时更新，源码=${sourceMode}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await expect(
      page.getByRole("button", { name: "内置插件", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    });
    const editor = page.locator(".ProseMirror:visible");
    await editor.evaluate((element) => {
      const ed = (element as HTMLElement & { editor: Editor }).editor;
      ed.commands.insertContent("base");
      ed.commands.setTextSelection(1);
    });
    if (sourceMode) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await selectSource(page.locator(".cm-content"), 0);
    }
    const open = async () => {
      await page.getByRole("button", { name: "内置插件", exact: true }).click();
    };
    await open();
    await page
      .getByRole("menuitem", { name: "插入日期与时间", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^日期 · YYYY-MM-DD ·/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "日期已插入并保存" }),
    ).toBeVisible();
    const date = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    });
    if (sourceMode) {
      expect((await sourceInfo(page.locator(".cm-content"))).value).toContain(
        date + "base",
      );
      await expect(page.locator(".cm-content")).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      expect((await sourceInfo(page.locator(".cm-content"))).value).toContain(
        "base",
      );
      expect(
        (await sourceInfo(page.locator(".cm-content"))).value,
      ).not.toContain(date);
    } else {
      await expect(editor).toContainText(date + "base");
      await expect(editor).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(editor).toHaveText("base");
    }
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("内置插件结果", { exact: true })).toHaveCount(
      0,
    );
    await open();
    await page
      .getByRole("menuitem", { name: "当前文档统计", exact: true })
      .click();
    const result = page.getByLabel("内置插件结果", { exact: true });
    await expect(result).toContainText("非空白字符 4");
    if (sourceMode)
      await replaceSource(page.locator(".cm-content"), "base more");
    else
      await editor.evaluate((element) => {
        (
          element as HTMLElement & { editor: Editor }
        ).editor.commands.insertContent("more");
      });
    await expect(result).toContainText("非空白字符 8");
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(false);
    });
    await expect(
      page.getByRole("button", { name: "内置插件", exact: true }),
    ).toHaveCount(0);
    await expect(result).toHaveCount(0);
    expect(
      await page.evaluate(async () => {
        const { pluginRuntime } =
          await import("/src/lib/plugin-system/runtime.ts");
        return pluginRuntime.getStatus().activations.length;
      }),
    ).toBe(0);
  });
}

for (const virtual of [false, true]) {
  test(`手机只读统计可用，日期禁用，单独停用释放结果，局部渲染=${virtual}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.evaluate(async (virtual) => {
      localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "nr:experimentalReadonlyRendering",
        }),
      );
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(true);
    }, virtual);
    await page.locator(".ProseMirror:visible").evaluate((element) => {
      (
        element as HTMLElement & { editor: Editor }
      ).editor.commands.insertContent("中文😀");
    });
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^(点击设为可编辑|设为可编辑)$/ }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "内置插件", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "插入日期与时间", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("menuitem", { name: "当前文档统计", exact: true })
      .click();
    await expect(
      page.getByLabel("内置插件结果", { exact: true }),
    ).toContainText("非空白字符 3");
    await page.evaluate(async () => {
      const { pluginLifecycle } =
        await import("/src/lib/plugin-system/lifecycle.ts");
      await pluginLifecycle.deactivate("nine-rings.builtin-statistics");
    });
    await expect(page.getByLabel("内置插件结果", { exact: true })).toHaveCount(
      0,
    );
  });
}

test("统计持续显示，Esc 关闭后释放订阅", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  await page.locator(".ProseMirror:visible").click();
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "当前文档统计", exact: true })
    .click();
  const result = page.getByLabel("内置插件结果", { exact: true });
  await expect(result).toContainText("非空白字符");
  await page.waitForTimeout(3300); // Prove statistics outlive the one-shot notification timer.
  await expect(result).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(result).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { pluginRuntime } =
          await import("/src/lib/plugin-system/runtime.ts");
        return pluginRuntime.getStatus().activations.length;
      }),
    )
    .toBe(0);
});

test("Esc 优先关闭插件结果，第二次才收起固定分栏", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const { saveSidebarPresentation } =
      await import("/src/hooks/useSidebarPresentation.ts");
    saveSidebarPresentation("overlay");
  });
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  await page.locator(".ProseMirror:visible").click();
  const sidebar = await openDocumentSidebar(page);
  await expect(page.locator(".app-body")).toHaveClass(/sidebar-hover-enabled/);
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "插入日期与时间", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^日期 · YYYY-MM-DD ·/ }).click();
  await expect(page.getByLabel("内置插件结果", { exact: true })).toContainText(
    "日期已插入并保存",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("内置插件结果", { exact: true })).toHaveCount(0);
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await expect(
    page.locator("[role=menu], [role=dialog][aria-modal=true]"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
});

test("结果展示配置持久化，统计状态栏与居中弹层即时切换", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    const { saveResultPresentation } =
      await import("/src/lib/plugin-system/result-presentation.ts");
    setPluginsEnabled(true);
    saveResultPresentation("statistics", {
      surface: "status",
      position: "center",
    });
  });
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "当前文档统计", exact: true })
    .click();
  const result = page.getByLabel("内置插件结果", { exact: true });
  await expect(result).toHaveClass(/builtin-plugin-status/);
  const textBounds = await result.getByRole("status").boundingBox();
  const closeBounds = await result
    .getByRole("button", { name: "关闭插件结果" })
    .boundingBox();
  expect(
    Math.abs(
      textBounds!.y +
        textBounds!.height / 2 -
        closeBounds!.y -
        closeBounds!.height / 2,
    ),
  ).toBeLessThan(2);
  await page.evaluate(async () => {
    const { saveResultPresentation, readResultPresentation } =
      await import("/src/lib/plugin-system/result-presentation.ts");
    saveResultPresentation("statistics", {
      surface: "popup",
      position: "center",
    });
    if (readResultPresentation("statistics").surface !== "popup")
      throw new Error("not persisted");
  });
  await expect(result).not.toHaveClass(/builtin-plugin-status/);
  await expect(result).toHaveAttribute("data-position", "center");
  const root = page.locator(".note-editor:visible").first();
  const a = await root.boundingBox();
  const b = await result.boundingBox();
  expect(Math.abs(b!.x + b!.width / 2 - (a!.x + a!.width / 2))).toBeLessThan(
    20,
  );
  await page.keyboard.press("Escape");
  await expect(result).toHaveCount(0);
});

test("日期通知三秒关闭，不改变编辑器焦点", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "插入日期与时间", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^日期 · YYYY-MM-DD ·/ }).click();
  const result = page.getByLabel("内置插件结果", { exact: true });
  await expect(result).toContainText("日期已插入并保存");
  await expect(editor).toBeFocused();
  await expect(result).toHaveCount(0, { timeout: 4500 });
  await expect(editor).toBeFocused();
});

test("日期时间参数菜单支持悬停、键盘进入和含秒格式，仍可一步撤销", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  await page.getByRole("button", { name: "内置插件", exact: true }).click();
  const parent = page.getByRole("menuitem", {
    name: "插入日期与时间",
    exact: true,
  });
  await parent.hover();
  const submenu = page.getByRole("menu", {
    name: "插入日期与时间参数",
    exact: true,
  });
  await expect(submenu).toBeVisible();
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await parent.focus();
  await page.keyboard.press("ArrowRight");
  await expect(submenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(submenu).toHaveCount(0);
  await expect(parent).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await submenu.getByRole("menuitem", { name: /^日期与时间（含秒）/ }).click();
  await expect(editor).toHaveText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText(/\d{4}-\d{2}/);
});
