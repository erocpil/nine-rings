import { useLayoutEffect, useState, type RefObject } from "react";
import type { FileNode, LocalFileFingerprint } from "../lib/local-files/file-model";

const formatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
export function browserModifiedText(value: number | undefined) {
  return value && Number.isFinite(new Date(value).getTime()) ? formatter.format(value) : "—";
}
/** Measure every loaded date, not only virtual rows, so scrolling cannot resize columns. */
export function useBrowserModifiedWidth(list: RefObject<HTMLDivElement>, nodes: readonly FileNode[], metadata: Record<string, LocalFileFingerprint>) {
  const [width, setWidth] = useState(145);
  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      const host = list.current?.closest(".file-browser-pane");
      const cell = host?.querySelector<HTMLElement>(".file-browser-row > span:last-child");
      const header = host?.querySelector<HTMLElement>(".file-browser-column:last-child > button");
      const context = document.createElement("canvas").getContext("2d");
      if (!host || !header || !context) return;
      const textWidth = (texts: Iterable<string>, element: Element, fallback: string) => {
        const style = getComputedStyle(element); context.font = style.font || fallback;
        const spacing = Number.parseFloat(style.letterSpacing) || 0;
        let maximum = 0;
        for (const text of texts) maximum = Math.max(maximum, context.measureText(text).width + spacing * Math.max(0, text.length - 1));
        return maximum;
      };
      let maximum = textWidth(["修改时间 ↑", "修改时间 ↓"], header, "12px sans-serif");
      if (cell) maximum = Math.max(maximum, textWidth(new Set(nodes.map(node => browserModifiedText(metadata[node.id]?.modifiedMs ?? node.modifiedMs))), cell, "11px sans-serif"));
      if (live) setWidth(Math.ceil(maximum) + 8); // Room for the resize handle and glyph rounding.
    };
    measure();
    void document.fonts.ready.then(() => { if (live) measure(); });
    document.fonts.addEventListener("loadingdone", measure);
    return () => { live = false; document.fonts.removeEventListener("loadingdone", measure); };
  }, [list, nodes, metadata]);
  return width;
}
