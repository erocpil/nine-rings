import { isCertifiedHTMLSource } from "./html-body-policy";
import { internalNoteId } from "../internal-note-link";

/** Destinations are data; certify only navigation forms supported by the host. */
export function isCertifiedLinkDestination(value: unknown): value is string {
  if (
    !isCertifiedHTMLSource(value) ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    value.trim() !== value
  )
    return false;
  if (/^nr-note:/i.test(value)) return internalNoteId(value) !== null;
  if (/^(?:https?|ftps?):/i.test(value) || value.startsWith("//")) {
    try {
      const url = new URL(value, "https://example.invalid/");
      return !!url.hostname && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  if (/^(?:mailto|tel):/i.test(value))
    return value.split(":").slice(1).join(":").length > 0;
  return !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.includes("\\");
}

export function isCertifiedLinkAttributes(
  attrs: Record<string, unknown>,
): boolean {
  return (
    (attrs.link === undefined || isCertifiedLinkDestination(attrs.link)) &&
    (attrs.linkExplicit === undefined ||
      (attrs.link !== undefined && attrs.linkExplicit === true)) &&
    (attrs.linkTitle === undefined ||
      (attrs.link !== undefined &&
        isCertifiedHTMLSource(attrs.linkTitle) &&
        attrs.linkTitle.length > 0))
  );
}
