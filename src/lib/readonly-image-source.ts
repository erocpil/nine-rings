/** Keep packaged/relative assets available without accepting active URL schemes. */
export function readonlyImageSource(source: string, baseURI: string): string {
  const src = source.trim();
  if (!src) return "";
  try {
    const url = new URL(src, baseURI), base = new URL(baseURI);
    if (/^(https?:|data:image\/|blob:)/i.test(url.href)
      || (url.protocol === base.protocol && url.host === base.host && url.origin === base.origin)) return src;
  } catch { /* Invalid image references keep their alt text. */ }
  return "";
}
