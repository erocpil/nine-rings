import { isCertifiedHTMLStyle } from "./html-body-policy";
import { normalizeEditorColor } from "../editor-color";
/** Portable block-image subset. Local references require resource resolution first. */
export function isCertifiedImageSource(value: unknown): value is string {
  if (typeof value !== "string" || !value || /\s/u.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return !!url.hostname && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  const data =
    /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!data || data[1].length % 4 !== 0) return false;
  // Canonical base64 prevents invalid padding/unused bits from being silently
  // normalized by one runtime. Image decoding is a separate viewer concern.
  try {
    return btoa(atob(data[1])) === data[1];
  } catch {
    return false;
  }
}

export function isCertifiedBlockImage(
  source: unknown,
  attrs: Record<string, unknown>,
): boolean {
  if (!isCertifiedImageSource(source)) return false;
  return Object.entries(attrs).every(([key, value]) => {
    if (key === "indent")
      return (
        Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 8
      );
    if (key === "indent-explicit") return value === true;
    if (key === "imageAlt" || key === "imageTitle")
      return typeof value === "string" && value.length > 0;
    if (key === "imageWidth")
      return (
        (Number.isSafeInteger(value) && (value as number) > 0) ||
        (typeof value === "string" &&
          /^[1-9]\d*px$/.test(value) &&
          Number.isSafeInteger(Number(value.slice(0, -2))))
      );
    return false;
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Inline atoms retain their marks and their exact position in the paragraph. */
export function isCertifiedInlineImage(
  value: unknown,
  attrs: Record<string, unknown>,
): boolean {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["src", "alt", "title", "width"].includes(key),
    ) ||
    !isCertifiedImageSource(value.src) ||
    typeof value.alt !== "string" ||
    !(
      value.title === null ||
      (typeof value.title === "string" && value.title.length > 0)
    ) ||
    (value.width !== undefined &&
      !isCertifiedBlockImage(value.src, { imageWidth: value.width }))
  )
    return false;
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
