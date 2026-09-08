import { looksLikeMarkdown } from "./md-parser";

/** Source copied from a browser/code viewer may be wrapped in div/p/br, but
 * real rich text (or a ProseMirror slice) must retain its marks and structure. */
export function shouldParseClipboardMarkdown(text: string, html = ""): boolean {
  if (!looksLikeMarkdown(text)) return false;
  if (!html.trim()) return true;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !doc.body.querySelector(
    "[data-pm-slice], h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, code, table, img, a, strong, b, em, i, s, del, u, [style]",
  );
}

/** Keep the two representations together; the destination determines which
 * one to use. readText remains a fallback for older WebViews. */
export async function readClipboardContent(): Promise<{ text: string; html: string }> {
  if (navigator.clipboard.read) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const [text, html] = await Promise.all([
        item.types.includes("text/plain") ? item.getType("text/plain").then((blob) => blob.text()) : "",
        item.types.includes("text/html") ? item.getType("text/html").then((blob) => blob.text()) : "",
      ]);
      if (text || html) return { text, html };
    }
  }
  return { text: await navigator.clipboard.readText(), html: "" };
}
