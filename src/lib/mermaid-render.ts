import type mermaidType from "mermaid";

export interface MermaidPalette {
  background: string;
  text: string;
  accent: string;
  border: string;
  darkMode: boolean;
  nodeBackground: string;
  nodeBackgroundAlt: string;
  nodeBackgroundTertiary: string;
}

let mermaidPromise: Promise<typeof mermaidType> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextId = 0;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then(module => module.default);
  return mermaidPromise;
}

// Keep diagrams on a stable light canvas. Source style/classDef colors and
// their labels must not be combined with the application's dark palette.
export const MERMAID_PALETTE: MermaidPalette = {
  background: "#ffffff",
  text: "#202124",
  accent: "#356ae6",
  border: "#8a98ac",
  darkMode: false,
  nodeBackground: "#e4edff",
  nodeBackgroundAlt: "#d1e0ff",
  nodeBackgroundTertiary: "#eef4ff",
};

/** Mermaid has global configuration and a shared temporary DOM. Serialize renders. */
export function renderMermaid(source: string, palette: MermaidPalette = MERMAID_PALETTE): Promise<string> {
  const render = async () => {
    if (!source.trim()) throw new Error("图表内容为空");
    if (source.length > 100_000) throw new Error("图表源码过长");
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      darkMode: palette.darkMode,
      themeVariables: {
        darkMode: false,
        background: palette.background,
        primaryColor: palette.nodeBackground,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.border,
        nodeBkg: palette.nodeBackground,
        nodeTextColor: palette.text,
        nodeBorder: palette.border,
        labelTextColor: palette.text,
        actorTextColor: palette.text,
        mainContrastColor: palette.text,
        secondaryColor: palette.nodeBackgroundAlt,
        secondaryTextColor: palette.text,
        secondaryBorderColor: palette.border,
        tertiaryColor: palette.nodeBackgroundTertiary,
        tertiaryTextColor: palette.text,
        tertiaryBorderColor: palette.border,
        lineColor: palette.accent,
        textColor: palette.text,
        mainBkg: palette.nodeBackground,
        clusterBkg: palette.nodeBackgroundTertiary,
        clusterBorder: palette.border,
        edgeLabelBackground: palette.background,
        noteBkgColor: palette.nodeBackgroundAlt,
        noteTextColor: palette.text,
        titleColor: palette.text,
      },
    });
    const parsed = await mermaid.parse(source, { suppressErrors: true });
    if (!parsed) throw new Error("图表语法有误");
    const { svg } = await mermaid.render(`nine-rings-mermaid-${++nextId}`, source);
    return svg;
  };
  const result = renderQueue.then(render);
  renderQueue = result.catch(() => undefined);
  return result;
}
