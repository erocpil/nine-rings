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
