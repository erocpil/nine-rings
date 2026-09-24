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

export function mermaidPalette(element: Element): MermaidPalette {
  const style = getComputedStyle(element);
  const background = style.getPropertyValue("--code-bg").trim() || "#f3f4f6";
  const text = style.getPropertyValue("--text").trim() || "#202124";
  const accent = style.getPropertyValue("--accent").trim() || "#356ae6";
  const darkMode = isDarkColor(background);
  return {
    background,
    text,
    accent,
    border: style.getPropertyValue("--border").trim() || "#bfc3ca",
    darkMode,
    nodeBackground: mixColor(accent, background, darkMode ? 0.34 : 0.18),
    nodeBackgroundAlt: mixColor(accent, background, darkMode ? 0.48 : 0.28),
    nodeBackgroundTertiary: mixColor(accent, background, darkMode ? 0.24 : 0.12),
  };
}

function mixColor(foreground: string, background: string, amount: number) {
  const parse = (value: string) => {
    const match = value.match(/^#([0-9a-f]{6})$/i);
    return match ? [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16)) : null;
  };
  const fg = parse(foreground), bg = parse(background);
  if (!fg || !bg) return foreground;
  return `#${fg.map((channel, index) => Math.round(channel * amount + bg[index] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function nodeTextColor(palette: MermaidPalette) {
  // A diagram may contain an explicit light/pink classDef even in a dark app
  // theme. Use the node fill, rather than the app background, to choose a
  // readable label color in that case.
  return isDarkColor(palette.nodeBackground) ? palette.text : "#202124";
}

function parseColor(value: string | null | undefined) {
  if (!value) return null;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(offset => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function contrastTextForShape(shape: Element | null, fallback: string) {
  const fill = shape?.getAttribute("fill") || shape?.getAttribute("style")?.match(/fill\s*:\s*([^;]+)/i)?.[1];
  const channels = parseColor(fill);
  if (!channels) return fallback;
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance < 0.42 ? "#f8f8f2" : "#202124";
}

function addContrastStyles(svg: string, palette: MermaidPalette) {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return svg;
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const labels = document.querySelectorAll("text,.nodeLabel,.edgeLabel,.cluster-label,.labelText,.messageText,.loopText,.noteText");
  labels.forEach(label => {
    const container = label.closest(".node,.cluster,.stateGroup,.statediagram-state,.actor,.actor-man,.actor-woman,.entityBox,.classGroup,.note,.section,.task");
    const shape = container?.querySelector("rect,circle,ellipse,polygon,path") ?? null;
    const color = contrastTextForShape(shape, nodeTextColor(palette));
    const current = label.getAttribute("style") ?? "";
    label.setAttribute("style", `${current};fill:${color} !important;color:${color} !important;`);
  });
  return new XMLSerializer().serializeToString(document.documentElement);
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
    return addContrastStyles(svg, palette);
  };
  const result = renderQueue.then(render);
  renderQueue = result.catch(() => undefined);
  return result;
}
