import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

for (const readonly of [false, true])
  test(`固定目录切换视图首帧保持布局，标题可收起：readonly=${readonly}`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          interface_style: "calm",
        }),
      ),
    );
    await page.addInitScript(() =>
      localStorage.setItem("nr:experimentalReadonlyRendering", "false"),
    );
    await createBlankDocument(page, "目录切换连续性");
    await page.locator(".ProseMirror:visible").evaluate((element) =>
      (element as any).editor.commands.setContent(
        {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "第一节" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "内容" }] },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "子标题" }],
            },
          ],
        },
        true,
      ),
    );
    await page.evaluate(async () => {
      const { saveWorkspaceLayout } =
        await import("/src/lib/workspace-layout.ts");
      saveWorkspaceLayout({ outlinePinned: true, panelWidth: 320 });
    });
    if (readonly)
      await page
        .getByRole("button", { name: "点击设为只读", exact: true })
        .click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await expect(dock).toBeVisible();
    await expect(
      dock.getByRole("button", { name: "收起固定目录", exact: true }),
    ).toHaveText("目录");
    await expect(
      dock
        .locator(".document-outline-header-actions")
        .getByRole("button", { name: "收起", exact: true }),
    ).toHaveCount(0);
    await expect(dock.locator(".document-outline-item.current")).toHaveCSS(
      "box-shadow",
      "none",
    );
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", {
      name: "Markdown 源码",
      exact: true,
    });
    await expect(source).toBeVisible();
    await expect(dock).toBeVisible();
    const expected = readonly ? "第一节" : "更新第一节";
    if (!readonly) {
      const info = await sourceInfo(source);
      await replaceSource(source, info.value.replace("第一节", expected));
      await expect(dock).toContainText(expected);
    }
    await page.evaluate(() => {
      const state = {
        frames: 0,
        renderedFrames: 0,
        failures: [] as string[],
        stop: false,
      };
      (window as any).__outlineFrames = state;
      const sample = () => {
        if (state.stop) return;
        state.frames++;
        const view = document.querySelector(".markdown-document-view")!;
        const panels = view.querySelectorAll<HTMLElement>(
          ".document-panel-dock",
        );
        if (panels.length !== 1) state.failures.push(`panels=${panels.length}`);
        else if (Math.abs(panels[0].getBoundingClientRect().width - 320) > 1)
          state.failures.push(
            `width=${panels[0].getBoundingClientRect().width}`,
          );
        if (!view.querySelector(".markdown-source-editor"))
          state.renderedFrames++;
        requestAnimationFrame(sample);
      };
      sample();
    });
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await expect(page.locator(".ProseMirror:visible")).toBeVisible();
    await expect(dock).toContainText(expected);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__outlineFrames.renderedFrames),
      )
      .toBeGreaterThan(4);
    const frames = await page.evaluate(() => {
      const state = (window as any).__outlineFrames;
      state.stop = true;
      return state.failures;
    });
    expect(frames).toEqual([]);
    await dock
      .getByRole("button", { name: "收起固定目录", exact: true })
      .click();
    await expect(dock).toHaveCount(0);
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    await expect(dock).toBeVisible();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(source).toBeVisible();
    await dock
      .getByRole("button", { name: "收起固定目录", exact: true })
      .click();
    await expect(dock).toHaveCount(0);
  });
