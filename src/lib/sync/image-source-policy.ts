import { isCertifiedHTMLSource } from "./html-body-policy";
/** Versioned logical resources shipped at these exact app-owned paths. */
export const BUNDLED_IMAGE_SOURCES = Object.freeze([
  "/icon-192.svg",
  "/ragdoll-32.png",
]);
export function isBundledImageSource(value: unknown): boolean {
  return typeof value === "string" && BUNDLED_IMAGE_SOURCES.includes(value);
}
/** Portable block-image subset. Local references require resource resolution first. */
export function isCertifiedImageSource(value: unknown): value is string {
  if (!isCertifiedHTMLSource(value) || !value || /\s/u.test(value))
    return false;
  if (isBundledImageSource(value)) return true;
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
