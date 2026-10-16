import type { JSONContent } from "@tiptap/core";
import { mdToDelta } from "../md-parser";
import { deltaToProseMirror } from "../delta-converter";
import { isCertifiedImageSource } from "./image-source-policy";

/** Flow retains its Markdown source as authority. Inspect derived images only;
 * do not replace the source with normalized inner Delta or renumber its footnotes. */
export function hasPortableRenderedResources(
  node: JSONContent,
  depth = 0,
): boolean {
  if (depth > 16) return false;
  if (
    ["image", "resizableImage", "markdownImage"].includes(node.type ?? "") &&
    !isCertifiedImageSource(node.attrs?.src)
  )
    return false;
  if (node.type === "codeBlock") {
    const language = String(node.attrs?.language ?? "")
      .trim()
      .toLowerCase();
    const source = (node.content ?? [])
      .map((child) => child.text ?? "")
      .join("");
    if (language === "flow")
      return hasPortableRenderedResources(
        deltaToProseMirror(mdToDelta(source)),
        depth + 1,
      );
    if (language === "mermaid") {
      // Certify quoted image attributes without rewriting the diagram's DSL.
      if (/(?:nr-image:\/\/|blob:|file:|<img\b)/i.test(source)) return false;
      const directives = [...source.matchAll(/\bimg\s*:/gi)];
      const images = [
        ...source.matchAll(/\bimg\s*:\s*(?:"([^"\\]*)"|'([^'\\]*)')/gi),
      ];
      if (
        images.length !== directives.length ||
        images.some((match) => !isCertifiedImageSource(match[1] ?? match[2]))
      )
        return false;
    }
  }
  return (node.content ?? []).every((child) =>
    hasPortableRenderedResources(child, depth + 1),
  );
}
