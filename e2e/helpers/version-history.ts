import { expect, type Page } from "@playwright/test";

/** The document menu owns history; the status bar intentionally has no history button. */
export async function openVersionHistory(page: Page) {
  await page.evaluate(async () => {
    const { runNativeMenuAction } = await import("/src/lib/native-menu-registry.ts");
    runNativeMenuAction("document.history");
  });
  await expect(page.getByRole("dialog", { name: "版本历史", exact: true })).toBeVisible();
}
