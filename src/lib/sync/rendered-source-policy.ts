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
    // Mermaid may reference images in its own DSL. Until those attachments can
    // be resolved, conservatively reject device-local schemes even in examples.
    if (
      language === "mermaid" &&
      /(?:nr-image:\/\/|blob:|file:|\bimg\s*:|<img\b)/i.test(source)
    )
      return false;
  }
  return (node.content ?? []).every((child) =>
    hasPortableRenderedResources(child, depth + 1),
  );
}
