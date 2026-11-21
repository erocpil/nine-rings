import type { QuoteAlert } from "./quote-alert-colors";

export interface MarkdownCallout {
  type: string;
  title: string;
  fold: "+" | "-" | null;
}

export function calloutAlert(type: string): QuoteAlert {
  switch (type.toLowerCase()) {
    case "tip": case "hint": return "TIP";
    case "important": return "IMPORTANT";
    case "warning": case "attention": return "WARNING";
    case "caution": case "danger": case "error": case "failure": case "bug": return "CAUTION";
    default: return "NOTE";
  }
}

export function calloutCaption(callout: MarkdownCallout | null | undefined): string | undefined {
  if (!callout) return;
  return callout.title || callout.type.charAt(0).toUpperCase() + callout.type.slice(1).toLowerCase();
}
