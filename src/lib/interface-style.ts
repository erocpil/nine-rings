export type InterfaceStyle = "classic" | "calm" | "calm-compact";
export const INTERFACE_STYLES: ReadonlyArray<{
  value: InterfaceStyle;
  label: string;
  description: string;
}> = [
  {
    value: "classic",
    label: "经典",
    description: "保留原有布局密度与控件外观",
  },
  {
    value: "calm",
    label: "清雅",
    description: "舒适留白、轻边框，让正文更突出",
  },
  {
    value: "calm-compact",
    label: "清雅·紧凑",
    description: "清雅的视觉层级，更紧凑的空间",
  },
];
export function normalizeInterfaceStyle(value: unknown): InterfaceStyle {
  return value === "calm" || value === "calm-compact" ? value : "classic";
}
/** Independent from theme classes and explicit typography preferences. */
export function applyInterfaceStyle(value: unknown): void {
  document.documentElement.dataset.interfaceStyle =
    normalizeInterfaceStyle(value);
}
