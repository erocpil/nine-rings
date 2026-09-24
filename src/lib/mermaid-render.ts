import type mermaidType from "mermaid";

export interface MermaidPalette {
  background: string;
  text: string;
  accent: string;
  border: string;
}

let mermaidPromise: Promise<typeof mermaidType> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextId = 0;

function loadMermaid() {
  mermaidPromise ??= import("mermaid").then(module => module.default);
  return mermaidPromise;
}

export function mermaidPalette(element: Element): MermaidPalette {
  const style = getComputedStyle(element);
  return {
    background: style.getPropertyValue("--code-bg").trim() || "#f3f4f6",
    text: style.getPropertyValue("--text").trim() || "#202124",
    accent: style.getPropertyValue("--accent").trim() || "#356ae6",
    border: style.getPropertyValue("--border").trim() || "#bfc3ca",
  };
}

/** Mermaid has global configuration and a shared temporary DOM. Serialize renders. */
export function renderMermaid(source: string, palette: MermaidPalette): Promise<string> {
  const render = async () => {
    if (!source.trim()) throw new Error("图表内容为空");
    if (source.length > 100_000) throw new Error("图表源码过长");
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: {
        background: palette.background,
        primaryColor: palette.background,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.border,
        secondaryColor: palette.background,
        secondaryTextColor: palette.text,
        secondaryBorderColor: palette.border,
        tertiaryColor: palette.background,
        tertiaryTextColor: palette.text,
        tertiaryBorderColor: palette.border,
        lineColor: palette.accent,
        textColor: palette.text,
        mainBkg: palette.background,
        nodeBorder: palette.border,
        clusterBkg: palette.background,
        clusterBorder: palette.border,
        edgeLabelBackground: palette.background,
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
