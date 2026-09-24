import type mermaidType from "mermaid";

export interface MermaidPalette {
  background: string;
  text: string;
  accent: string;
  border: string;
  darkMode: boolean;
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
  const background = style.getPropertyValue("--code-bg").trim() || "#f3f4f6";
  const text = style.getPropertyValue("--text").trim() || "#202124";
  const darkMode = isDarkColor(background);
  return {
    background,
    text,
    accent: style.getPropertyValue("--accent").trim() || "#356ae6",
    border: style.getPropertyValue("--border").trim() || "#bfc3ca",
    darkMode,
  };
}

function isDarkColor(color: string) {
  const match = color.match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return false;
  const value = match[1];
  const hex = value.length === 3
    ? value.split("").map(part => part + part).join("")
    : value.slice(0, 6);
  const channels = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.42;
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
      // Mermaid otherwise derives dark mode from its own defaults. That can
      // make a light application theme render dark node rectangles with dark
      // labels, especially in WebView implementations.
      darkMode: palette.darkMode,
      themeVariables: {
        background: palette.background,
        primaryColor: palette.background,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.border,
        nodeBkg: palette.background,
        nodeTextColor: palette.text,
        nodeBorder: palette.border,
        labelTextColor: palette.text,
        actorTextColor: palette.text,
        mainContrastColor: palette.text,
        secondaryColor: palette.background,
        secondaryTextColor: palette.text,
        secondaryBorderColor: palette.border,
        tertiaryColor: palette.background,
        tertiaryTextColor: palette.text,
        tertiaryBorderColor: palette.border,
        lineColor: palette.accent,
        textColor: palette.text,
        mainBkg: palette.background,
        clusterBkg: palette.background,
        clusterBorder: palette.border,
        edgeLabelBackground: palette.background,
        noteBkgColor: palette.background,
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
