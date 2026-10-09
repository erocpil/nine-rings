import { createContext, useMemo, type ReactNode } from "react";
import type { AppConfig } from "../types/models";
import { blockFontFamily, customFontSize } from "../lib/editor-appearance";
import type { MermaidTypography } from "../lib/mermaid-render";

export const MermaidTypographyContext = createContext<MermaidTypography>({});

export function ReadingTypographyProvider({ config, children }: { config?: Partial<AppConfig> | null; children: ReactNode }) {
  const family = config?.editor_mermaid_font_family;
  const size = config?.editor_mermaid_font_size;
  const value = useMemo(() => ({ fontFamily: blockFontFamily(family), fontSize: customFontSize(size) }), [family, size]);
  return <MermaidTypographyContext.Provider value={value}>{children}</MermaidTypographyContext.Provider>;
}
