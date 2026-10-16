const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 10000;
const label = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim() || value.length > 256)
    return false;
  for (const char of value)
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
};
export const FOOTNOTE_ATTRIBUTES = new Set([
  "footnoteRef",
  "footnoteNumber",
  "footnoteOccurrence",
]);
/** References are serialized text marks, not literal Markdown source. */
export function isCertifiedFootnoteReference(
  text: string,
  attrs: Record<string, unknown>,
): boolean {
  if (![...FOOTNOTE_ATTRIBUTES].some((key) => attrs[key] !== undefined))
    return true;
  return (
    label(attrs.footnoteRef) &&
    count(attrs.footnoteNumber) &&
    attrs.footnoteNumber > 0 &&
    count(attrs.footnoteOccurrence) &&
    attrs.footnoteOccurrence > 0 &&
    text === String(attrs.footnoteNumber)
  );
}
/** Shape validation only; numbering/counts are checked in full document context. */
export function isCertifiedFootnotes(
  value: unknown,
  child: (ops: unknown) => boolean,
): boolean {
  if (!Array.isArray(value) || !value.length || value.length > 10000)
    return false;
  const ids = new Set<string>();
  return value.every((definition) => {
    if (
      !record(definition) ||
      Object.keys(definition).some(
        (key) => !["id", "number", "references", "content"].includes(key),
      ) ||
      !label(definition.id) ||
      ids.has(definition.id) ||
      !(
        definition.number === null ||
        (count(definition.number) && definition.number > 0)
      ) ||
      !count(definition.references) ||
      !child(definition.content)
    )
      return false;
    ids.add(definition.id);
    return true;
  });
}
