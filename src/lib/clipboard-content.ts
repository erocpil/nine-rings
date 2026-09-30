import { isMarkdownTableRow, looksLikeMarkdown } from "./md-parser";

/** Source copied from a browser/code viewer may be wrapped in div/p/br, but
 * real rich text (or a ProseMirror slice) must retain its marks and structure. */
export function shouldParseClipboardMarkdown(text: string, html = ""): boolean {
  if (!looksLikeMarkdown(text)) return false;
  if (!html.trim()) return true;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const containsMarkdownTable = lines.some((line, index) =>
    isMarkdownTableRow(line)
      && /^\s*\|\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|\s*$/.test(lines[index + 1] ?? ""),
  );
  // Clipboard HTML may contain a browser-rendered table while text/plain
  // contains its Markdown source. Prefer the source representation so table
  // parsing and alignment follow the same Markdown path as plain-text paste.
  // Keep our own rich clipboard slices intact, since they carry editor metadata.
  if (containsMarkdownTable && !html.includes("data-pm-slice")) return true;

  const doc = new DOMParser().parseFromString(html, "text/html");

  // Some apps put each copied Markdown source line in a styled paragraph (and
  // may mark Markdown punctuation as bold/italic). That is still source text:
  // parse its block markers unless the HTML already represents those blocks
  // structurally. Otherwise list markers become literal text and the Markdown
  // serializer has to escape them on the next round trip.
  const blockSignals = lines.filter((line) =>
    /^\s*(?:#{1,6}\s+\S.*|>\s+\S.*|[-*+]\s+\S.*|\d+\.\s+\S.*|(?:-{3,}|_{3,}|\*{3,})\s*)$/.test(line),
  ).length;
  if (blockSignals >= 2 && !doc.body.querySelector(
    "[data-pm-slice], h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, img, a",
  )) return true;

  return !doc.body.querySelector(
    "[data-pm-slice], h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, code, table, img, a, strong, b, em, i, s, del, u, [style]",
  );
}

/** Keep the two representations together; the destination determines which
 * one to use. readText remains a fallback for older WebViews. */
export async function readClipboardContent(): Promise<{
  text: string;
  html: string;
}> {
  if (navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const [text, html] = await Promise.all([
          item.types.includes("text/plain")
            ? item.getType("text/plain").then((blob) => blob.text())
            : "",
          item.types.includes("text/html")
            ? item.getType("text/html").then((blob) => blob.text())
            : "",
        ]);
        if (text || html) return { text, html };
      }
    } catch {
      // Some WebViews expose read() but only permit readText(). Preserve the
      // native text permission/error rather than failing the toolbar outright.
    }
  }
  return { text: await navigator.clipboard.readText(), html: "" };
}
