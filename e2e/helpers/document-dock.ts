import { expect, type Locator, type Page } from "@playwright/test";
import { measureDocumentRail } from "./document";

export async function expectNarrowDocumentDock(
  workspace: Locator,
  dock: Locator,
  { source, groups, description }: { source: boolean; groups: number; description: string },
) {
  await expect.poll(async () => {
    const [rail, geometry] = await Promise.all([
      measureDocumentRail(workspace, source),
      dock.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const owner = element.closest(".note-editor")!.getBoundingClientRect();
        const customGroups = element.querySelectorAll(".document-dock-group");
        const sections = [...(customGroups.length ? customGroups : element.querySelectorAll(".document-panel-slot"))]
          .map(section => section.getBoundingClientRect());
        const overlap = sections.flatMap((section, index) => sections.slice(index + 1).map(other => Math.min(
          Math.min(section.right, other.right) - Math.max(section.left, other.left),
          Math.min(section.bottom, other.bottom) - Math.max(section.top, other.top),
        )));
        return {
          left: bounds.left, right: bounds.right, dockOnRight: element.classList.contains("dock-right"),
          sections: sections.filter(section => section.width > 0 && section.height > 0).length,
          overflow: Math.max(
            0, -owner.left, owner.right - document.documentElement.clientWidth,
            owner.left - bounds.left, bounds.right - owner.right, bounds.bottom - owner.bottom,
            ...sections.flatMap(section => [
              bounds.left - section.left, section.right - bounds.right,
              bounds.top - section.top, section.bottom - bounds.bottom,
            ]),
            ...overlap,
          ),
        };
      }),
    ]);
    if (!rail.docked || !rail.title || !rail.toolbar || !rail.status ||
        rail.titleWidth <= rail.width || rail.width <= 0 || geometry.sections !== groups) return Infinity;
    const dockOverlap = geometry.dockOnRight ? rail.left + rail.width - geometry.left : geometry.right - rail.left;
    return Math.max(rail.maxDifference, geometry.overflow, dockOverlap);
  }, { message: description }).toBeLessThan(2);
}

export async function dragDockPanel(
  page: Page,
  source: Locator,
  target: Locator,
  drop: "before" | "tab" | "after",
  cancel = false,
) {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const header =
    drop === "tab"
      ? (await target
          .locator(
            ".document-dock-tabs:visible, .document-outline-header:visible, .document-bookmark-header:visible, .vr-panel > h3:visible",
          )
          .first()
          .boundingBox())!
      : null;
  const y = header
    ? header.y + Math.max(12, header.height / 2)
    : drop === "before"
      ? to.y + 3
      : to.y + to.height - 3;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, y, { steps: 12 });
  await expect(target).toHaveAttribute("data-dock-drop", drop);
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
