/** Rust JSON strings and browser DOM text must agree on Unicode. */
export function isCertifiedHTMLSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Structural HTML only. No arbitrary attributes, event handlers or CSS. */
export const isCertifiedHTMLStyle = (value: unknown): boolean =>
  typeof value === "string" && ["sub", "sup", "ins"].includes(value);

export function isCertifiedHTMLDetails(
  value: unknown,
  child: (ops: unknown) => boolean,
): boolean {
  return (
    record(value) &&
    Object.keys(value).every((key) =>
      ["summary", "open", "content"].includes(key),
    ) &&
    isCertifiedHTMLSource(value.summary) &&
    typeof value.open === "boolean" &&
    child(value.content)
  );
}

export function isCertifiedHTMLAnchor(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    /\s/u.test(value)
  )
    return false;
  for (const char of value)
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/** Unrecognized HTML is certified only as inert source, never parsed into live DOM. */
export function isCertifiedHTMLInline(
  insert: Record<string, unknown>,
  attrs: Record<string, unknown>,
): boolean {
  if (Object.keys(insert).length !== 1 || Object.keys(attrs).length)
    return false;
  return (
    isCertifiedHTMLSource(insert.rawHtmlInline) ||
    isCertifiedHTMLAnchor(insert.htmlAnchor)
  );
}
