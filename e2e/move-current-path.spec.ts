import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`移动文档自动定位当前路径，超过 200 项也可见 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.locator(".note-editor")).toBeVisible();
    const currentPath = "references/folder-249/current";
    await page.evaluate(async currentPath => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const React = (await load("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { MoveToDialog } = await load("/src/components/MoveToDialog.tsx");
      const { api } = await load("/src/lib/api.ts");
      // Also exercise asynchronous tree loading and a current path omitted by
      // that summary: the selector must still include the known source path.
      api.docs.tree = async () => Array.from({ length: 260 }, (_, i) => ({
        type: "folder", path: `references/folder-${String(i).padStart(3, "0")}`,
      }));
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      root.render(React.createElement(MoveToDialog, {
        subject: { kind: "document", noteId: "test", title: "当前位置测试", currentPath },
        onClose: () => root.unmount(), onMove: async () => {},
      }));
    }, currentPath);
    const dialog = page.getByRole("dialog", { name: "移动到", exact: true });
    const list = dialog.getByRole("listbox", { name: "已有目录" });
    const selected = list.locator('[aria-selected="true"]');
    await expect(selected).toContainText(currentPath);
    await expect(selected).toBeDisabled();
    await expect.poll(() => selected.evaluate(element => {
      const row = element.getBoundingClientRect();
      const bounds = element.closest('[role="listbox"]')!.getBoundingClientRect();
      return row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1;
    })).toBe(true);
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await list.getByRole("option").count()).toBeLessThanOrEqual(200);
    const input = dialog.getByPlaceholder("输入目录名称或路径…");
    await expect(input).toBeFocused();
    await input.fill("folder-000");
    await expect(list.getByRole("option")).toHaveCount(1);
    await list.getByRole("option").click();
    await expect(dialog.getByPlaceholder("例如 archives/old")).toHaveValue("references/folder-000");
  });
}
