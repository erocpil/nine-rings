import { expect, test, type Locator } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { closeDocumentSidebar } from "../helpers/workspace";

async function pressedBackground(button: Locator) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
  let color = "";
  await expect.poll(async () => {
    color = await button.evaluate(element => getComputedStyle(element).backgroundColor);
    return color !== "" && color !== "rgba(0, 0, 0, 0)";
  }).toBe(true);
  return color;
}

for (const style of ["classic", "calm"]) for (const focus of [false, true]) test(`更多工具跨源码与渲染共享状态及高亮 style=${style} focus=${focus}`, async ({ page }) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style })), style);
  await createBlankDocument(page, "更多工具状态");
  await closeDocumentSidebar(page);
  if (focus) await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const tools = page.getByRole("button", { name: "更多工具", exact: true });
  if (await tools.getAttribute("aria-expanded") !== "false") await tools.click();
  await tools.click();
  const renderedColor = await pressedBackground(tools);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-pressed", "true");
  await expect(tools).toHaveCSS("background-color", renderedColor);
  await expect(page.locator(".markdown-source-toolbar-host")).toBeVisible();
  await tools.click();
  await expect(tools).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".markdown-source-toolbar-host")).toBeHidden();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".note-editor:visible")).not.toHaveClass(/focus-toolbar-expanded/);
});

test("手机更多工具在两种模式中使用相同按下背景", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm" })));
  await createBlankDocument(page, "手机工具状态");
  await closeDocumentSidebar(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const tools = page.getByRole("button", { name: "更多工具", exact: true });
  if (await tools.getAttribute("aria-pressed") !== "true") await tools.click();
  const color = await pressedBackground(tools);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-pressed", "true");
  await expect(tools).toHaveCSS("background-color", color);
});
