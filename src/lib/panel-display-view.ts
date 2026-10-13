import type { PanelDisplayContribution } from "./plugin-system/panel-display";
import type { DocumentBookmark } from "../types/models";
/** Theme tokens only; no plugin CSS or literal colors enter a host surface. */
export function panelDisplayStyle(display: PanelDisplayContribution | null) {
  return display
    ? {
        "--list-display-font":
          display.font === "mono"
            ? "var(--font-mono)"
            : display.font === "sans"
              ? "var(--font)"
              : "inherit",
        "--list-display-font-size": `${display.fontSize}px`,
        "--list-display-row-height": `${display.rowHeight}px`,
        "--list-display-color":
          display.labelColor === "accent"
            ? "var(--accent)"
            : display.labelColor === "secondary"
              ? "var(--text-secondary)"
              : "var(--text)",
      }
    : undefined;
}
export function bookmarkTooltip(
  bookmark: DocumentBookmark,
  display: PanelDisplayContribution | null,
) {
  return display?.tooltip === "name"
    ? bookmark.label || bookmark.preview
    : bookmark.label
      ? `${bookmark.label}\n${bookmark.preview}`
      : bookmark.preview;
}
/** Sorting is a projection. Stored anchor order and identity are never mutated. */
export function sortedPanelItems<T>(
  items: readonly T[],
  display: PanelDisplayContribution | null,
  label: (item: T) => string,
  date: (item: T) => string,
  id: (item: T) => string,
): readonly T[] {
  if (!display?.order || display.order === "host") return items;
  return [...items].sort(
    (a, b) =>
      (display.order === "name"
        ? label(a).localeCompare(label(b), "zh-CN", { numeric: true })
        : date(b).localeCompare(date(a))) || id(a).localeCompare(id(b)),
  );
}
export function sortedBookmarks<T extends DocumentBookmark>(
  items: readonly T[],
  display: PanelDisplayContribution | null,
): readonly T[] {
  return sortedPanelItems(
    items,
    display,
    (item) => item.label || item.preview,
    (item) => item.createdAt,
    (item) => item.id,
  );
}
