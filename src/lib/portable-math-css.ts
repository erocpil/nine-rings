import katexCss from "katex/dist/katex.min.css?raw";

const fonts = import.meta.glob<string>("/node_modules/katex/dist/fonts/*.woff2", { query: "?inline", import: "default" });
let stylesheet: Promise<string> | undefined;

export function portableMathCSS() {
  return stylesheet ??= Promise.all(Object.entries(fonts).map(async ([path, load]) =>
    [path.slice(path.lastIndexOf("/") + 1), await load()] as const,
  )).then(entries => {
    const embedded = new Map(entries);
    return katexCss.replace(/src:url\(fonts\/([^\s)]+\.woff2)\)[^;}]+/g, (source, name: string) => {
      const url = embedded.get(name);
      return url ? `src:url(${url}) format("woff2")` : source;
    });
  });
}
