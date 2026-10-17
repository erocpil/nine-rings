import { themeLuminance } from "./plugin-system/theme-resources";

export const QUOTE_ALERTS = {
  NOTE: { label: "提示", symbol: "ⓘ", light: "#356c91", dark: "#91bdd7" },
  TIP: { label: "建议", symbol: "◇", light: "#466c42", dark: "#a0c495" },
  IMPORTANT: { label: "重要", symbol: "❖", light: "#79568f", dark: "#c4a5db" },
  WARNING: { label: "警告", symbol: "⚠", light: "#896219", dark: "#d9bc77" },
  CAUTION: { label: "风险", symbol: "!", light: "#a05043", dark: "#dfaa9f" },
} as const;
export type QuoteAlert = keyof typeof QUOTE_ALERTS;
export function quoteContrast(a: string, b: string) {
  const x = themeLuminance(a), y = themeLuminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function mixQuoteColor(a: string, b: string, amount: number): string {
  return "#" + [1, 3, 5].map(offset => Math.round(
    parseInt(a.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(b.slice(offset, offset + 2), 16) * amount,
  ).toString(16).padStart(2, "0")).join("");
}
/** Keep the hue when possible; fall back rather than publish illegible labels. */
export function quoteAlertPalette(backgrounds: readonly string[], text: string): Record<QuoteAlert, string> | null {
  if (!backgrounds.length || ![...backgrounds, text].every(color => /^#[\da-f]{6}$/i.test(color))) return null;
  const dark = themeLuminance(backgrounds[0]) < .3;
  const safe = (color: string) => backgrounds.every(background =>
    quoteContrast(color, mixQuoteColor(background, color, .035)) >= 4.5);
  const result = {} as Record<QuoteAlert, string>;
  for (const [kind, definition] of Object.entries(QUOTE_ALERTS)) {
    const seed = dark ? definition.dark : definition.light;
    let ink: string | undefined;
    for (const target of [text, "#000000", "#ffffff"]) {
      for (let step = 0; step <= 20; step++) {
        const candidate = mixQuoteColor(seed, target, step / 20);
        if (safe(candidate)) { ink = candidate; break; }
      }
      if (ink) break;
    }
    if (!ink) return null;
    result[kind as QuoteAlert] = ink;
  }
  return result;
}
