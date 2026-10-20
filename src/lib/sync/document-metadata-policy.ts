import type { JSONContent } from "@tiptap/core";
import { CODE_LANGUAGE_OPTIONS } from "../code-language-options";
import { isCertifiedHTMLSource } from "./html-body-policy";
import { isCertifiedLinkDestination } from "./link-body-policy";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = isCertifiedHTMLSource;
const timestamp = (value: unknown): boolean => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60
  );
};
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const webURL = (value: unknown): boolean =>
  typeof value === "string" &&
  /^https?:\/\//i.test(value) &&
  isCertifiedLinkDestination(value);
const strings = [
  "sourceLanguage",
  "originalFileName",
  "markdownSource",
  "author",
  "organization",
  "email",
  "website",
  "summary",
  "language",
  "version",
  "copyright",
  "license",
];
const allowed = [
  ...strings,
  "keywords",
  "sourceFormat",
  "sourceText",
  "presentationMode",
  "flowHeadingLevel",
  "externalSource",
  "pdfExcerpt",
  "epubExcerpt",
  "bookmarks",
  "referenceAnchors",
];

export function isCertifiedDocumentMetadata(
  metadata: Record<string, unknown>,
): boolean {
  if (!keys(metadata, allowed)) return false;
  // Source is displayed as text, never injected as HTML.
  if (metadata.sourceText !== undefined && typeof metadata.sourceText !== "string") return false;
  for (const key of strings)
    if (metadata[key] !== undefined && !text(metadata[key])) return false;
  if (metadata.sourceLanguage !== undefined && !CODE_LANGUAGE_OPTIONS.some(option => option.value === metadata.sourceLanguage)) return false;
  if (
    metadata.keywords !== undefined &&
    (!Array.isArray(metadata.keywords) ||
      metadata.keywords.length > 10000 ||
      !metadata.keywords.every(text))
  )
    return false;
  if (
    metadata.sourceFormat !== undefined &&
    (typeof metadata.sourceFormat !== "string" ||
      !["text", "markdown"].includes(metadata.sourceFormat))
  )
    return false;
  if (
    metadata.presentationMode !== undefined &&
    metadata.presentationMode !== "flow"
  )
    return false;
  if (
    metadata.flowHeadingLevel !== undefined &&
    (!integer(metadata.flowHeadingLevel, 1) || metadata.flowHeadingLevel > 6)
  )
    return false;
  if (metadata.externalSource !== undefined) {
    const v = metadata.externalSource;
    if (
      !record(v) ||
      !keys(v, [
        "kind",
        "url",
        "resolvedUrl",
        "provider",
        "contentHash",
        "localContentHash",
        "etag",
        "lastModified",
        "syncedAt",
      ]) ||
      v.kind !== "markdown-url" ||
      typeof v.provider !== "string" ||
      !["github", "generic"].includes(v.provider) ||
      !webURL(v.url) ||
      !webURL(v.resolvedUrl) ||
      !timestamp(v.syncedAt)
    )
      return false;
    for (const key of ["contentHash", "localContentHash"])
      if (typeof v[key] !== "string" || !/^[0-9a-z]+-[0-9a-z]+$/.test(v[key]))
        return false;
    for (const key of ["etag", "lastModified"])
      if (v[key] !== undefined && !text(v[key])) return false;
  }
  if (metadata.pdfExcerpt !== undefined) {
    const v = metadata.pdfExcerpt;
    if (
      !record(v) ||
      !keys(v, [
        "pdfId",
        "pdfName",
        "page",
        "selectedText",
        "highlightId",
        "anchorStart",
        "anchorEnd",
      ]) ||
      !text(v.pdfId) ||
      !v.pdfId ||
      !text(v.pdfName) ||
      !text(v.selectedText) ||
      !integer(v.page, 1)
    )
      return false;
    if (v.highlightId !== undefined && (!text(v.highlightId) || !v.highlightId))
      return false;
    if ((v.anchorStart === undefined) !== (v.anchorEnd === undefined))
      return false;
    if (
      v.anchorStart !== undefined &&
      (!integer(v.anchorStart) ||
        !integer(v.anchorEnd) ||
        v.anchorEnd < v.anchorStart)
    )
      return false;
  }
  if (metadata.epubExcerpt !== undefined) {
    const v = metadata.epubExcerpt;
    if (
      !record(v) ||
      !keys(v, [
        "epubId",
        "epubName",
        "chapter",
        "chapterTitle",
        "selectedText",
        "highlightId",
        "anchor",
      ]) ||
      !text(v.epubId) ||
      !v.epubId ||
      !text(v.epubName) ||
      !text(v.chapterTitle) ||
      !text(v.selectedText) ||
      !integer(v.chapter)
    )
      return false;
    if (v.highlightId !== undefined && (!text(v.highlightId) || !v.highlightId))
      return false;
    const a = v.anchor;
    if (
      !record(a) ||
      !keys(a, ["chapterPath", "start", "end", "exact", "prefix", "suffix"]) ||
      !text(a.chapterPath) ||
      !integer(a.start) ||
      !integer(a.end) ||
      a.end < a.start ||
      ![a.exact, a.prefix, a.suffix].every(text)
    )
      return false;
  }
  return true;
}

export function isCertifiedBookmarks(
  value: unknown,
  document: JSONContent,
  sizeOf: (node: JSONContent) => number,
): boolean {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const starts = new Set<number>();
  const visit = (node: JSONContent, pos: number) => {
    if (["paragraph", "heading", "codeBlock"].includes(node.type ?? ""))
      starts.add(pos + 1);
    let childPos = node.type === "doc" ? 0 : pos + 1;
    for (const child of node.content ?? []) {
      visit(child, childPos);
      childPos += sizeOf(child);
    }
  };
  visit(document, 0);
  const ids = new Set<string>(),
    named = new Set<string>();
  let previous: Record<string, unknown> | undefined;
  for (const v of value) {
    if (
      !record(v) ||
      !keys(v, ["id", "position", "preview", "createdAt", "key", "label"]) ||
      typeof v.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(v.id) ||
      ids.has(v.id) ||
      !integer(v.position) ||
      !starts.has(v.position) ||
      !text(v.preview) ||
      !v.preview ||
      v.preview.trim() !== v.preview ||
      !timestamp(v.createdAt)
    )
      return false;
    if (
      v.key !== undefined &&
      (typeof v.key !== "string" || !/^[a-z]$/.test(v.key) || named.has(v.key))
    )
      return false;
    if (
      v.label !== undefined &&
      (!text(v.label) || !v.label || v.label.trim() !== v.label)
    )
      return false;
    if (
      previous &&
      (Number(previous.position) > v.position ||
        (previous.position === v.position &&
          String(previous.createdAt).localeCompare(String(v.createdAt)) > 0))
    )
      return false;
    ids.add(v.id);
    if (typeof v.key === "string") named.add(v.key);
    previous = v;
  }
  return true;
}
