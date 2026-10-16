import { isCertifiedImageSource } from "./image-source-policy";
import { isCertifiedHTMLStyle } from "./html-body-policy";
import { normalizeEditorColor } from "../editor-color";
/** Shared marks for portable inline atoms; schemas still undergo exact roundtrip validation. */
export function isCertifiedInlineAtomAttributes(
  attrs: Record<string, unknown>,
): boolean {
  if (
    (attrs.background !== undefined && attrs.highlight !== true) ||
    (attrs.code && Object.keys(attrs).length > 1) ||
    ((attrs.linkTitle !== undefined || attrs.linkExplicit !== undefined) &&
      attrs.link === undefined)
  )
    return false;
  return Object.entries(attrs).every(([key, value]) => {
    if (
      [
        "bold",
        "italic",
        "strike",
        "code",
        "highlight",
        "linkExplicit",
      ].includes(key)
    )
      return value === true;
    if (key === "color" || key === "background")
      return typeof value === "string" && normalizeEditorColor(value) === value;
    if (key === "size")
      return (
        typeof value === "string" &&
        ["small", "normal", "large", "huge"].includes(value)
      );
    if (key === "link")
      return (
        typeof value === "string" &&
        /^https?:\/\//i.test(value) &&
        isCertifiedImageSource(value)
      );
    if (key === "htmlStyle") return isCertifiedHTMLStyle(value);
    if (key === "linkTitle")
      return typeof value === "string" && value.length > 0;
    return false;
  });
}
