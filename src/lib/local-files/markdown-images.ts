import { isBrowserImagePath } from "./browser-preview";
import { resolveRelativeNode } from "./file-model";

/** Match the image rendering boundary for a relative Markdown destination. */
export function localMarkdownImageNode(fromNode: string, src: string): string | null {
  const [path] = src.split(/[?#]/, 1);
  if (!path || /^\\/.test(path) || /%(?:2f|5c|00|3a)/i.test(path)) return null;
  try {
    const node = resolveRelativeNode(fromNode, path);
    return isBrowserImagePath(node) ? node : null;
  } catch {
    return null;
  }
}
