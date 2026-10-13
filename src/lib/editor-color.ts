/** Limited opaque colors only; never accepts arbitrary CSS or URL functions. */
export function normalizeEditorColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color))
    return (
      "#" +
      color
        .slice(1)
        .split("")
        .map((part) => part + part)
        .join("")
    );
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(
    color,
  );
  return rgb && rgb.slice(1).every((part) => Number(part) <= 255)
    ? "#" +
        rgb
          .slice(1)
          .map((part) => Number(part).toString(16).padStart(2, "0"))
          .join("")
    : null;
}
export function editorBackgroundStyle(value: unknown): string | undefined {
  const color = normalizeEditorColor(value);
  return color ? `color-mix(in srgb, ${color} 30%, var(--bg))` : undefined;
}
