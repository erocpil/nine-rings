import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toggleTauriFullscreen } from "../lib/fullscreen";
import { isTauriRuntime } from "../lib/runtime";
import {
  addLocalEpubBookmark,
  addLocalEpubHighlight,
  deleteLocalEpubBookmark,
  deleteLocalEpubHighlight,
  getLocalEpub,
  listLocalEpubBookmarks,
  listLocalEpubHighlights,
  parseEpubArchiveAsync,
  resolveEpubPath,
  updateLocalEpubHighlight,
  updateLocalEpubProgress,
  type EpubTextAnchor,
  type EpubTocItem,
  type LocalEpubBookmark,
  type LocalEpubEntry,
  type LocalEpubHighlight,
  type LocalEpubLineMerge,
  type ParsedEpub,
} from "../lib/epub-library";

interface Props {
  documentId: string;
  onClose: () => void;
  initialHighlightId?: string | null;
  onFullscreenChange?: (fullscreen: boolean) => void;
  onCreateExcerpt?: (excerpt: { epubId: string; epubName: string; chapter: number; chapterTitle: string; selectedText: string; highlightId: string; anchor: EpubTextAnchor }) => Promise<void>;
}

interface EpubSelection {
  anchor: EpubTextAnchor;
  text: string;
  lineMergeBoundary?: Pick<LocalEpubLineMerge, "left" | "right">;
}

interface ViewportTextAnchor { text: string; offsetY: number; }

interface EpubSearchMatch {
  chapter: number;
  offset: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  css: "text/css",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

const EPUB_THEME_DEFAULT_BACKGROUNDS = { light: "#fffdf9", sepia: "#f4ecd8", dark: "#202124" } as const;
const EPUB_BACKGROUND_PRESETS = ["#ffffff", "#fffdf9", "#f7f1df", "#eaf2e3", "#e8f0f7", "#202124", "#17191c"];

function isDarkColor(color: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = value >> 16;
  const green = value >> 8 & 0xff;
  const blue = value & 0xff;
  return red * .299 + green * .587 + blue * .114 < 145;
}

function mimeForPath(path: string): string {
  return MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

function chapterPlainText(book: ParsedEpub, chapter: number, smartLineMerge = false, manualLineMerges: LocalEpubLineMerge[] = []): string {
  const bytes = book.files[book.chapters[chapter].path];
  if (!bytes) return "";
  const source = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, style").forEach((node) => node.remove());
  applyManualLineMerges(document, manualLineMerges.filter((fix) => fix.chapterPath === book.chapters[chapter].path));
  if (smartLineMerge) normalizeHardLineBreaks(document);
  return document.body.textContent ?? "";
}

function isHardLineContinuation(previous: string, next: string): boolean {
  const left = previous.replace(/\s+/g, " ").trim();
  const right = next.replace(/\s+/g, " ").trim();
  if (!left || !right || left.length > 180 || right.length > 180) return false;
  if (/[.!?。！？:：;；]$/.test(left) || /^[—–•▪◦]/.test(right)) return false;
  return /^[a-zà-öø-ÿ]/.test(right);
}

function normalizeHardLineBreaks(document: Document): void {
  const excluded = "h1,h2,h3,h4,h5,h6,li,pre,code,table,figure,figcaption,blockquote,address,nav";
  document.querySelectorAll("br").forEach((breakNode) => {
    if (breakNode.parentElement?.closest(excluded)) return;
    const previous = breakNode.previousSibling?.textContent ?? "";
    const next = breakNode.nextSibling?.textContent ?? "";
    if (isHardLineContinuation(previous, next)) breakNode.replaceWith(document.createTextNode(" "));
  });
  const candidates = [...document.querySelectorAll<HTMLElement>("p, div")];
  for (const element of candidates) {
    if (!element.isConnected || element.closest(excluded) || element.querySelector("p, div, br, ul, ol, table, pre, blockquote")) continue;
    if (/poem|verse|stanza|title|heading|caption|credit|author/i.test(element.className)) continue;
    if (/text-align\s*:\s*(?:center|right)/i.test(element.getAttribute("style") ?? "")) continue;
    let next = element.nextElementSibling as HTMLElement | null;
    while (next && /^(p|div)$/.test(next.tagName.toLowerCase())
      && !next.closest(excluded)
      && !next.querySelector("p, div, br, ul, ol, table, pre, blockquote")
      && !/poem|verse|stanza|title|heading|caption|credit|author/i.test(next.className)
      && !/text-align\s*:\s*(?:center|right)/i.test(next.getAttribute("style") ?? "")
      && isHardLineContinuation(element.textContent ?? "", next.textContent ?? "")) {
      element.append(document.createTextNode(" "), ...Array.from(next.childNodes));
      const following = next.nextElementSibling as HTMLElement | null;
      next.remove();
      next = following;
    }
  }
  document.body.normalize();
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function applyManualLineMerges(document: Document, fixes: LocalEpubLineMerge[]): void {
  for (const fix of fixes) {
    let applied = false;
    for (const breakNode of [...document.querySelectorAll("br")]) {
      const parentText = normalizedText(breakNode.parentElement?.textContent ?? "");
      if (!parentText.includes(fix.left) || !parentText.includes(fix.right)) continue;
      breakNode.replaceWith(document.createTextNode(" "));
      applied = true;
      break;
    }
    if (applied) continue;
    for (const leftElement of [...document.querySelectorAll<HTMLElement>("p, div")]) {
      if (!leftElement.isConnected || !normalizedText(leftElement.textContent ?? "").endsWith(fix.left)) continue;
      let rightElement = leftElement.nextElementSibling as HTMLElement | null;
      while (rightElement && !normalizedText(rightElement.textContent ?? "")) rightElement = rightElement.nextElementSibling as HTMLElement | null;
      if (!rightElement || !/^(p|div)$/i.test(rightElement.tagName) || !normalizedText(rightElement.textContent ?? "").startsWith(fix.right)) continue;
      leftElement.append(document.createTextNode(" "), ...Array.from(rightElement.childNodes));
      rightElement.remove();
      applied = true;
      break;
    }
  }
  document.body.normalize();
}

function selectionLineMergeBoundary(range: Range): Pick<LocalEpubLineMerge, "left" | "right"> | undefined {
  const elementFor = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement);
  const startElement = elementFor(range.startContainer);
  const endElement = elementFor(range.endContainer);
  const startBlock = startElement?.closest("p, div");
  const endBlock = endElement?.closest("p, div");
  if (startBlock && endBlock && startBlock !== endBlock) {
    const left = normalizedText(startBlock.textContent ?? "").slice(-48);
    const right = normalizedText(endBlock.textContent ?? "").slice(0, 48);
    return left && right ? { left, right } : undefined;
  }
  const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  const crossedBreak = root && [...root.querySelectorAll("br")].find((node) => range.intersectsNode(node));
  if (!crossedBreak) return undefined;
  const left = normalizedText(crossedBreak.previousSibling?.textContent ?? "").slice(-48);
  const right = normalizedText(crossedBreak.nextSibling?.textContent ?? "").slice(0, 48);
  return left && right ? { left, right } : undefined;
}

function captureViewportTextAnchor(document: Document, window: Window): ViewportTextAnchor | null {
  const caretRange = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
    .caretRangeFromPoint?.(Math.max(20, window.innerWidth / 2), 96);
  const node = caretRange?.startContainer;
  if (!node || node.nodeType !== 3 || !(node as Text).data.trim()) return null;
  const textNode = node as Text;
  const from = Math.max(0, caretRange.startOffset - 12);
  const text = textNode.data.slice(from, from + 60).trim();
  return text.length >= 8 ? { text, offsetY: 96 } : null;
}

function restoreViewportTextAnchor(document: Document, window: Window, anchor: ViewportTextAnchor): boolean {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const index = node.data.indexOf(anchor.text);
    if (index < 0) continue;
    node.parentElement?.scrollIntoView({ block: "start" });
    const range = document.createRange();
    range.setStart(node, Math.min(index, node.data.length));
    range.setEnd(node, Math.min(node.data.length, index + 1));
    window.scrollBy(0, range.getBoundingClientRect().top - anchor.offsetY);
    return true;
  }
  return false;
}

function markFrameSearch(document: Document, query: string, activeOccurrence: number): HTMLElement | null {
  document.querySelectorAll("mark.epub-search-hit").forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent ?? "")));
  if (!query) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest("script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  let occurrence = 0;
  let activeMark: HTMLElement | null = null;
  const needle = query.toLocaleLowerCase();
  textNodes.forEach((textNode) => {
    const source = textNode.data;
    const lower = source.toLocaleLowerCase();
    const ranges: Array<{ start: number; end: number; occurrence: number }> = [];
    let from = 0;
    while (from <= lower.length - needle.length) {
      const start = lower.indexOf(needle, from);
      if (start < 0) break;
      ranges.push({ start, end: start + query.length, occurrence });
      occurrence += 1;
      from = start + Math.max(1, query.length);
    }
    for (const range of ranges.reverse()) {
      const matched = textNode.splitText(range.start);
      matched.splitText(range.end - range.start);
      const mark = document.createElement("mark");
      mark.className = `epub-search-hit${range.occurrence === activeOccurrence ? " epub-search-current" : ""}`;
      matched.replaceWith(mark);
      mark.append(matched);
      if (range.occurrence === activeOccurrence) activeMark = mark;
    }
  });
  document.body.normalize();
  return activeMark;
}

function resolveAnchor(text: string, anchor: EpubTextAnchor): { start: number; end: number } | null {
  if (text.slice(anchor.start, anchor.end) === anchor.exact) return { start: anchor.start, end: anchor.end };
  const candidates: number[] = [];
  let from = 0;
  while (from <= text.length - anchor.exact.length) {
    const index = text.indexOf(anchor.exact, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, anchor.exact.length);
  }
  if (candidates.length === 0) return null;
  const best = candidates.sort((left, right) => {
    const score = (index: number) => Number(text.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix)
      + Number(text.slice(index + anchor.exact.length, index + anchor.exact.length + anchor.suffix.length) === anchor.suffix);
    return score(right) - score(left) || Math.abs(left - anchor.start) - Math.abs(right - anchor.start);
  })[0];
  return { start: best, end: best + anchor.exact.length };
}

function markFrameHighlights(document: Document, highlights: LocalEpubHighlight[], targetId?: string | null): HTMLElement | null {
  document.querySelectorAll("mark.epub-highlight").forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent ?? "")));
  document.body.normalize();
  const bodyText = document.body.textContent ?? "";
  let target: HTMLElement | null = null;
  [...highlights].reverse().forEach((highlight) => {
    const range = resolveAnchor(bodyText, highlight.anchor);
    if (!range) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let offset = 0;
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const end = offset + node.data.length;
      if (end > range.start && offset < range.end) nodes.push({ node, start: Math.max(0, range.start - offset), end: Math.min(node.data.length, range.end - offset) });
      offset = end;
    }
    nodes.reverse().forEach(({ node, start, end }) => {
      const selected = node.splitText(start);
      selected.splitText(end - start);
      const mark = document.createElement("mark");
      mark.className = `epub-highlight${highlight.id === targetId ? " epub-highlight-target" : ""}`;
      mark.dataset.highlightId = highlight.id;
      mark.style.backgroundColor = highlight.color;
      selected.replaceWith(mark);
      mark.append(selected);
      if (highlight.id === targetId) target = mark;
    });
  });
  return target;
}

function rewriteCssResources(css: string, basePath: string, resourceUrl: (path: string) => string | null): string {
  return css
    .replace(/@import\s+(?:url\()?[^;]+;?/gi, "")
    .replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote, href: string) => {
      if (/^(?:data:|blob:|#)/i.test(href)) return match;
      if (/^(?:https?:|\/\/)/i.test(href)) return "url(\"\")";
      const targetUrl = resourceUrl(resolveEpubPath(basePath, href).path);
      return targetUrl ? `url("${targetUrl}")` : "url(\"\")";
    });
}

function createResourceRegistry(book: ParsedEpub) {
  const urls = new Map<string, string>();
  const resourceUrl = (path: string): string | null => {
    if (urls.has(path)) return urls.get(path)!;
    const bytes = book.files[path];
    if (!bytes) return null;
    const mime = mimeForPath(path);
    let body: BlobPart = bytes;
    if (mime === "text/css") {
      const css = rewriteCssResources(new TextDecoder().decode(bytes), path, resourceUrl);
      body = css;
    }
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    urls.set(path, url);
    return url;
  };
  return {
    resourceUrl,
    destroy() { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); },
  };
}

function safeChapterDocument(
  book: ParsedEpub,
  chapterPath: string,
  resourceUrl: (path: string) => string | null,
  fontSize: number,
  theme: LocalEpubEntry["theme"],
  customBackground?: string,
  smartLineMerge = false,
  manualLineMerges: LocalEpubLineMerge[] = [],
): string {
  const bytes = book.files[chapterPath];
  if (!bytes) throw new Error("EPUB 章节内容不存在");
  const source = new TextDecoder().decode(bytes);
  let document = new DOMParser().parseFromString(source, "application/xhtml+xml");
  if (document.querySelector("parsererror")) document = new DOMParser().parseFromString(source, "text/html") as unknown as XMLDocument;

  document.querySelectorAll("script, iframe, frame, object, embed, form, input, button, textarea, select, base, meta[http-equiv]").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (/^javascript:/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
    }
  });

  const rewrite = (selector: string, attribute: string) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const href = element.getAttribute(attribute);
      if (!href || /^(?:data:|blob:|#)/i.test(href)) return;
      if (/^(?:https?:|\/\/)/i.test(href)) {
        element.removeAttribute(attribute);
        return;
      }
      const url = resourceUrl(resolveEpubPath(chapterPath, href).path);
      if (url) element.setAttribute(attribute, url);
      else element.removeAttribute(attribute);
    });
  };
  rewrite("img[src], source[src], audio[src], video[src]", "src");
  rewrite("video[poster]", "poster");
  rewrite('link[rel~="stylesheet"][href]', "href");
  rewrite("image[href]", "href");
  rewrite("image[xlink\\:href]", "xlink:href");
  rewrite("use[href]", "href");
  rewrite("use[xlink\\:href]", "xlink:href");
  document.querySelectorAll("[srcset]").forEach((element) => element.removeAttribute("srcset"));
  document.querySelectorAll('link:not([rel~="stylesheet"])').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const sourceStyle = element.getAttribute("style") ?? "";
    const style = rewriteCssResources(sourceStyle, chapterPath, resourceUrl);
    if (style) element.setAttribute("style", style);
  });
  document.querySelectorAll("style").forEach((element) => {
    element.textContent = rewriteCssResources(element.textContent ?? "", chapterPath, resourceUrl);
  });
  applyManualLineMerges(document, manualLineMerges.filter((fix) => fix.chapterPath === chapterPath));
  if (smartLineMerge) normalizeHardLineBreaks(document);

  const palettes = {
    light: { background: "#fffdf9", text: "#25231f", link: "#315f9b" },
    sepia: { background: "#f4ecd8", text: "#403629", link: "#7b542c" },
    dark: { background: "#202124", text: "#e8eaed", link: "#8ab4f8" },
  } as const;
  const safeCustomBackground = customBackground && /^#[0-9a-f]{6}$/i.test(customBackground) ? customBackground : undefined;
  const palette: { background: string; text: string; link: string } = { ...palettes[theme], background: safeCustomBackground ?? palettes[theme].background };
  if (safeCustomBackground) {
    const darkBackground = isDarkColor(safeCustomBackground);
    palette.text = darkBackground ? "#edf0f2" : "#25231f";
    palette.link = darkBackground ? "#8ab4f8" : "#315f9b";
  }
  const style = document.createElement("style");
  style.textContent = `
    :root { color-scheme: ${theme === "dark" ? "dark" : "light"}; }
    html { background: ${palette.background}; color: ${palette.text}; font-size: ${fontSize}%; }
    body { box-sizing: border-box; max-width: 48rem; min-height: 100vh; margin: 0 auto; padding: 2rem clamp(1.1rem, 5vw, 3rem) 5rem; font-family: ui-serif, Georgia, "Noto Serif CJK SC", serif; line-height: 1.75; overflow-wrap: anywhere; }
    img, svg, video { max-width: 100% !important; height: auto !important; }
    table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    a { color: ${palette.link}; }
    pre { overflow-x: auto; white-space: pre-wrap; }
    mark.epub-search-hit { padding: 0 .08em; border-radius: .15em; background: #ffe082; color: #241c00; }
    mark.epub-search-current { outline: 2px solid #ef6c00; background: #ffca28; }
    mark.epub-highlight { padding: 0 .04em; border-radius: .12em; cursor: pointer; color: inherit; }
    mark.epub-highlight-target { outline: 2px solid #ef6c00; }
  `;
  (document.head ?? document.documentElement.insertBefore(document.createElement("head"), document.documentElement.firstChild)).appendChild(style);
  return `<!doctype html>${new XMLSerializer().serializeToString(document.documentElement)}`;
}

export function EpubReader({ documentId, onClose, initialHighlightId, onFullscreenChange, onCreateExcerpt }: Props) {
  const readerRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const registryRef = useRef<ReturnType<typeof createResourceRegistry> | null>(null);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const focusControlsTimerRef = useRef<number | null>(null);
  const themeLongPressTimerRef = useRef<number | null>(null);
  const themeLongPressTriggeredRef = useRef(false);
  const swipeNoticeTimerRef = useRef<number | null>(null);
  const pendingViewportAnchorRef = useRef<ViewportTextAnchor | null>(null);
  const fullscreenRef = useRef(false);
  const [entry, setEntry] = useState<LocalEpubEntry | null>(null);
  const [book, setBook] = useState<ParsedEpub | null>(null);
  const [chapter, setChapter] = useState(0);
  const [fragment, setFragment] = useState<string | undefined>();
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<LocalEpubEntry["theme"]>("light");
  const [themeBackgrounds, setThemeBackgrounds] = useState<NonNullable<LocalEpubEntry["themeBackgrounds"]>>({});
  const [colorPaletteTheme, setColorPaletteTheme] = useState<LocalEpubEntry["theme"] | null>(null);
  const [smartLineMerge, setSmartLineMerge] = useState(false);
  const [manualLineMerges, setManualLineMerges] = useState<LocalEpubLineMerge[]>([]);
  const [lineMergePanelOpen, setLineMergePanelOpen] = useState(false);
  const [swipeNotice, setSwipeNotice] = useState<string | null>(null);
  const [collapsedTocItems, setCollapsedTocItems] = useState<Set<string>>(() => new Set());
  const [scrollProgress, setScrollProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [completedSearchQuery, setCompletedSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<EpubSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [highlights, setHighlights] = useState<LocalEpubHighlight[]>([]);
  const [bookmarks, setBookmarks] = useState<LocalEpubBookmark[]>([]);
  const [selection, setSelection] = useState<EpubSelection | null>(null);
  const [targetHighlightId, setTargetHighlightId] = useState(initialHighlightId ?? null);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [focusControlsVisible, setFocusControlsVisible] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fullscreenRef.current = fullscreen; }, [fullscreen]);

  const hideFocusControls = useCallback(() => {
    if (focusControlsTimerRef.current !== null) window.clearTimeout(focusControlsTimerRef.current);
    focusControlsTimerRef.current = null;
    setFocusControlsVisible(false);
  }, []);

  const showFocusControls = useCallback(() => {
    if (!fullscreenRef.current) return;
    if (focusControlsTimerRef.current !== null) window.clearTimeout(focusControlsTimerRef.current);
    setFocusControlsVisible(true);
    focusControlsTimerRef.current = window.setTimeout(() => {
      focusControlsTimerRef.current = null;
      setFocusControlsVisible(false);
    }, 1000);
  }, []);

  const toggleFocusControls = useCallback(() => {
    if (!fullscreenRef.current) return;
    if (focusControlsTimerRef.current !== null) window.clearTimeout(focusControlsTimerRef.current);
    focusControlsTimerRef.current = null;
    setFocusControlsVisible((visible) => {
      if (visible) return false;
      focusControlsTimerRef.current = window.setTimeout(() => {
        focusControlsTimerRef.current = null;
        setFocusControlsVisible(false);
      }, 1000);
      return true;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getLocalEpub(documentId).then(async (stored) => {
      if (!stored) throw new Error("EPUB 不存在或已经被删除");
      const [parsed, storedHighlights, storedBookmarks] = await Promise.all([
        parseEpubArchiveAsync(await stored.blob.arrayBuffer()),
        listLocalEpubHighlights(documentId),
        listLocalEpubBookmarks(documentId),
      ]);
      if (cancelled) return;
      registryRef.current?.destroy();
      registryRef.current = createResourceRegistry(parsed);
      setEntry(stored.entry);
      setBook(parsed);
      const targetHighlight = storedHighlights.find((highlight) => highlight.id === initialHighlightId);
      const targetChapter = targetHighlight ? parsed.chapters.findIndex((item) => item.path === targetHighlight.anchor.chapterPath) : -1;
      const savedChapter = targetChapter >= 0 ? targetChapter : Math.max(0, Math.min(parsed.chapters.length - 1, stored.entry.chapter));
      setChapter(savedChapter);
      const savedLocation = stored.entry.location?.split("#", 2);
      setFragment(savedLocation?.[0] === parsed.chapters[savedChapter].path ? savedLocation[1] : undefined);
      setFontSize(stored.entry.fontSize || 100);
      setTheme(stored.entry.theme || "light");
      setThemeBackgrounds(stored.entry.themeBackgrounds ?? {});
      setSmartLineMerge(Boolean(stored.entry.smartLineMerge));
      setManualLineMerges(stored.entry.manualLineMerges ?? []);
      setScrollProgress(stored.entry.scrollProgress ?? 0);
      setHighlights(storedHighlights);
      setBookmarks(storedBookmarks);
      setTargetHighlightId(initialHighlightId ?? null);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
      if (focusControlsTimerRef.current !== null) window.clearTimeout(focusControlsTimerRef.current);
      if (themeLongPressTimerRef.current !== null) window.clearTimeout(themeLongPressTimerRef.current);
      if (swipeNoticeTimerRef.current !== null) window.clearTimeout(swipeNoticeTimerRef.current);
      registryRef.current?.destroy();
      registryRef.current = null;
    };
  }, [documentId, initialHighlightId]);

  const chapterResult = useMemo(() => {
    if (!book || !registryRef.current) return { html: "", error: null as string | null };
    try {
      return { html: safeChapterDocument(book, book.chapters[chapter].path, registryRef.current.resourceUrl, fontSize, theme, themeBackgrounds[theme], smartLineMerge, manualLineMerges), error: null };
    } catch (reason) {
      return { html: "", error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [book, chapter, fontSize, manualLineMerges, smartLineMerge, theme, themeBackgrounds]);
  const displayError = error ?? chapterResult.error;

  const tocTree = useMemo<EpubTocItem[]>(() => book
    ? (book.toc.length > 0 ? book.toc : book.chapters.map((item) => ({ label: item.title, path: item.path, href: item.path, fragment: undefined, children: [] })))
    : [], [book]);
  const collapsibleTocItems = useMemo(() => {
    const ids = new Set<string>();
    const visit = (items: EpubTocItem[], parentId = "toc") => items.forEach((item, index) => {
      const id = `${parentId}/${index}:${item.href}`;
      if (item.children.length > 0) ids.add(id);
      visit(item.children, id);
    });
    visit(tocTree);
    return ids;
  }, [tocTree]);
  const progress = book ? Math.round((chapter + 1) / book.chapters.length * 100) : 0;

  const readFrameScrollProgress = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameDocument || !frameWindow) return scrollProgress;
    const root = frameDocument.documentElement;
    const body = frameDocument.body;
    const top = Math.max(frameWindow.scrollY, root.scrollTop, body.scrollTop);
    const viewportHeight = Math.max(1, frameWindow.innerHeight, root.clientHeight);
    const maximum = Math.max(0, root.scrollHeight, body.scrollHeight) - viewportHeight;
    return maximum > 0 ? Math.max(0, Math.min(1, top / maximum)) : 0;
  }, [scrollProgress]);

  const runSearch = useCallback((direction: 1 | -1 = 1) => {
    if (!book) return;
    const query = searchQuery.trim();
    if (!query) {
      setCompletedSearchQuery("");
      setSearchMatches([]);
      setActiveSearchIndex(-1);
      return;
    }
    let matches = searchMatches;
    if (query !== completedSearchQuery) {
      const needle = query.toLocaleLowerCase();
      matches = book.chapters.flatMap((_item, chapterIndex) => {
        const text = chapterPlainText(book, chapterIndex, smartLineMerge, manualLineMerges).toLocaleLowerCase();
        const chapterMatches: EpubSearchMatch[] = [];
        let from = 0;
        while (from <= text.length - needle.length) {
          const offset = text.indexOf(needle, from);
          if (offset < 0) break;
          chapterMatches.push({ chapter: chapterIndex, offset });
          from = offset + Math.max(1, needle.length);
        }
        return chapterMatches;
      });
      setCompletedSearchQuery(query);
      setSearchMatches(matches);
    }
    if (matches.length === 0) {
      setActiveSearchIndex(-1);
      return;
    }
    const nextIndex = query !== completedSearchQuery
      ? (direction === 1 ? 0 : matches.length - 1)
      : (activeSearchIndex + direction + matches.length) % matches.length;
    setActiveSearchIndex(nextIndex);
    setFragment(undefined);
    setScrollProgress(0);
    setChapter(matches[nextIndex].chapter);
  }, [activeSearchIndex, book, completedSearchQuery, manualLineMerges, searchMatches, searchQuery, smartLineMerge]);

  const navigateTo = useCallback((path: string, targetFragment?: string) => {
    if (!book) return;
    const index = book.chapters.findIndex((item) => item.path === path);
    if (index < 0) return;
    setChapter(index);
    setFragment(targetFragment);
    setScrollProgress(0);
  }, [book]);

  useEffect(() => {
    if (!fragment) return;
    iframeRef.current?.contentDocument?.getElementById(fragment)?.scrollIntoView();
  }, [chapter, fragment]);

  const persistProgress = useCallback(async (liveScrollProgress = scrollProgress) => {
    if (!entry || !book) return;
    const current = book.chapters[chapter];
    await updateLocalEpubProgress(entry.id, {
      chapter,
      location: `${current.path}${fragment ? `#${fragment}` : ""}`,
      fontSize,
      theme,
      themeBackgrounds,
      smartLineMerge,
      manualLineMerges,
      scrollProgress: liveScrollProgress,
    });
  }, [book, chapter, entry, fontSize, fragment, manualLineMerges, scrollProgress, smartLineMerge, theme, themeBackgrounds]);

  useEffect(() => {
    void persistProgress().catch((reason) => console.warn("[EPUB] 保存阅读进度失败:", reason));
  }, [persistProgress]);

  const closeReader = useCallback(() => {
    void persistProgress(readFrameScrollProgress())
      .catch((reason) => console.warn("[EPUB] 保存最终阅读进度失败:", reason))
      .finally(onClose);
  }, [onClose, persistProgress, readFrameScrollProgress]);

  useEffect(() => {
    const flushLiveProgress = () => { void persistProgress(readFrameScrollProgress()).catch(() => {}); };
    const handleVisibility = () => { if (document.visibilityState === "hidden") flushLiveProgress(); };
    window.addEventListener("pagehide", flushLiveProgress);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", flushLiveProgress);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [persistProgress, readFrameScrollProgress]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && lineMergePanelOpen) {
        setLineMergePanelOpen(false);
      }
      else if (event.key === "Escape" && bookmarkPanelOpen) {
        setBookmarkPanelOpen(false);
      }
      else if (event.key === "Escape" && fullscreen) {
        if (!document.fullscreenElement) { setFullscreen(false); onFullscreenChange?.(false); }
      }
      else if (event.key === "Escape") closeReader();
      else if (event.key === "ArrowLeft" || event.key === "PageUp") setChapter((value) => Math.max(0, value - 1));
      else if (event.key === "ArrowRight" || event.key === "PageDown") setChapter((value) => book ? Math.min(book.chapters.length - 1, value + 1) : value);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [book, bookmarkPanelOpen, closeReader, fullscreen, lineMergePanelOpen, onFullscreenChange]);

  const showSwipeNotice = useCallback((message: string) => {
    if (swipeNoticeTimerRef.current !== null) window.clearTimeout(swipeNoticeTimerRef.current);
    setSwipeNotice(message);
    swipeNoticeTimerRef.current = window.setTimeout(() => {
      swipeNoticeTimerRef.current = null;
      setSwipeNotice(null);
    }, 1400);
  }, []);

  const handleFrameLoad = () => {
    const frameDocument = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameDocument || !frameWindow || !book) return;
    const chapterSearchMatches = searchMatches.filter((match) => match.chapter === chapter);
    const activeMatch = searchMatches[activeSearchIndex];
    const activeOccurrence = activeMatch?.chapter === chapter
      ? chapterSearchMatches.findIndex((match) => match === activeMatch)
      : -1;
    const chapterHighlights = highlights.filter((highlight) => highlight.anchor.chapterPath === book.chapters[chapter].path);
    const targetMark = markFrameHighlights(frameDocument, chapterHighlights, targetHighlightId);
    const activeMark = markFrameSearch(frameDocument, completedSearchQuery, activeOccurrence);
    const viewportAnchor = pendingViewportAnchorRef.current;
    pendingViewportAnchorRef.current = null;
    if (viewportAnchor) {
      const restoreAnchor = () => restoreViewportTextAnchor(frameDocument, frameWindow, viewportAnchor);
      window.requestAnimationFrame(restoreAnchor);
      window.setTimeout(restoreAnchor, 80);
      window.setTimeout(restoreAnchor, 240);
    }
    else if (targetMark) targetMark.scrollIntoView({ block: "center" });
    else if (activeMark) activeMark.scrollIntoView({ block: "center" });
    else if (fragment) frameDocument.getElementById(fragment)?.scrollIntoView();
    else if (scrollProgress > 0) {
      const restoreScroll = () => {
        const root = frameDocument.documentElement;
        const body = frameDocument.body;
        const maximum = Math.max(0, root.scrollHeight, body.scrollHeight) - Math.max(1, frameWindow.innerHeight, root.clientHeight);
        const top = scrollProgress * Math.max(0, maximum);
        frameWindow.scrollTo(0, top);
        root.scrollTop = top;
        body.scrollTop = top;
      };
      window.requestAnimationFrame(restoreScroll);
      window.setTimeout(restoreScroll, 80);
      window.setTimeout(restoreScroll, 240);
    }
    const captureScroll = () => {
      if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = window.setTimeout(() => {
        const root = frameDocument.documentElement;
        const body = frameDocument.body;
        const top = Math.max(frameWindow.scrollY, root.scrollTop, body.scrollTop);
        const maximum = Math.max(0, root.scrollHeight, body.scrollHeight) - Math.max(1, frameWindow.innerHeight, root.clientHeight);
        setScrollProgress(maximum > 0 ? Math.max(0, Math.min(1, top / maximum)) : 0);
      }, 160);
    };
    const captureFrameSelection = () => {
      const current = frameWindow.getSelection();
      if (!current || current.rangeCount === 0 || current.isCollapsed) { setSelection(null); return; }
      const range = current.getRangeAt(0);
      if (!frameDocument.body.contains(range.commonAncestorContainer)) return;
      const before = frameDocument.createRange();
      before.selectNodeContents(frameDocument.body);
      before.setEnd(range.startContainer, range.startOffset);
      const text = current.toString().trim();
      if (!text) { setSelection(null); return; }
      const start = before.toString().length + current.toString().indexOf(text);
      const bodyText = frameDocument.body.textContent ?? "";
      setSelection({
        text,
        lineMergeBoundary: selectionLineMergeBoundary(range),
        anchor: {
          chapterPath: book.chapters[chapter].path,
          start,
          end: start + text.length,
          exact: text,
          prefix: bodyText.slice(Math.max(0, start - 32), start),
          suffix: bodyText.slice(start + text.length, start + text.length + 32),
        },
      });
    };
    frameWindow.addEventListener("scroll", captureScroll, { passive: true });
    frameDocument.addEventListener("scroll", captureScroll, { passive: true, capture: true });
    let gestureStart: { x: number; y: number; time: number } | null = null;
    let pointerGestureActive = false;
    let lastHandledTouch = 0;
    const finishGesture = (x: number, y: number) => {
      if (!gestureStart) return;
      const selection = frameWindow.getSelection();
      if (selection && !selection.isCollapsed) { gestureStart = null; captureFrameSelection(); return; }
      const deltaX = x - gestureStart.x;
      const deltaY = y - gestureStart.y;
      const elapsed = Date.now() - gestureStart.time;
      gestureStart = null;
      lastHandledTouch = Date.now();
      if (elapsed <= 900 && Math.abs(deltaX) < 18 && Math.abs(deltaY) < 18) {
        toggleFocusControls();
        return;
      }
      if (elapsed > 900 || Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
      setFragment(undefined);
      setScrollProgress(0);
      if (deltaX < 0) {
        if (chapter >= book.chapters.length - 1) showSwipeNotice("已经是最后一章");
        else setChapter(chapter + 1);
      } else if (chapter <= 0) showSwipeNotice("已经是第一章");
      else setChapter(chapter - 1);
    };
    frameDocument.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      pointerGestureActive = true;
      gestureStart = { x: event.clientX, y: event.clientY, time: Date.now() };
    }, { passive: true });
    frameDocument.addEventListener("pointerup", (event) => {
      if (!pointerGestureActive) return;
      pointerGestureActive = false;
      finishGesture(event.clientX, event.clientY);
    }, { passive: true });
    frameDocument.addEventListener("pointercancel", () => { pointerGestureActive = false; gestureStart = null; }, { passive: true });
    frameDocument.addEventListener("touchstart", (event) => {
      if (pointerGestureActive || event.touches.length !== 1) return;
      gestureStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
    }, { passive: true });
    frameDocument.addEventListener("touchend", (event) => {
      if (pointerGestureActive || !gestureStart || event.changedTouches.length !== 1) return;
      finishGesture(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
    }, { passive: true });
    frameDocument.addEventListener("click", () => {
      if (Date.now() - lastHandledTouch > 500) toggleFocusControls();
    });
    frameDocument.addEventListener("mouseup", captureFrameSelection);
    frameDocument.addEventListener("selectionchange", () => window.requestAnimationFrame(captureFrameSelection));
    frameDocument.addEventListener("click", (event) => {
      const marked = (event.target as { closest?: (selector: string) => Element | null } | null)?.closest?.("mark.epub-highlight") as HTMLElement | null;
      if (!marked?.dataset.highlightId) return;
      setTargetHighlightId(marked.dataset.highlightId);
      setAnnotationOpen(true);
    });
    frameDocument.addEventListener("click", (event) => {
      // iframe 有独立的 DOM realm，不能用父窗口的 instanceof Element 判断。
      const anchor = (event.target as { closest?: (selector: string) => Element | null } | null)
        ?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || /^(?:https?:|mailto:|tel:)/i.test(href)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const target = resolveEpubPath(book.chapters[chapter].path, href);
      navigateTo(target.path || book.chapters[chapter].path, target.fragment);
    });
  };

  const changeChapter = (next: number) => {
    if (!book) return;
    setFragment(undefined);
    setScrollProgress(0);
    setChapter(Math.max(0, Math.min(book.chapters.length - 1, next)));
  };

  useEffect(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) return;
    const chapterMatches = searchMatches.filter((match) => match.chapter === chapter);
    const activeMatch = searchMatches[activeSearchIndex];
    const activeOccurrence = activeMatch?.chapter === chapter
      ? chapterMatches.findIndex((match) => match === activeMatch)
      : -1;
    const chapterHighlights = highlights.filter((highlight) => highlight.anchor.chapterPath === book?.chapters[chapter].path);
    const targetMark = markFrameHighlights(frameDocument, chapterHighlights, targetHighlightId);
    const searchMark = markFrameSearch(frameDocument, completedSearchQuery, activeOccurrence);
    (targetMark ?? searchMark)?.scrollIntoView({ block: "center" });
  }, [activeSearchIndex, book, chapter, completedSearchQuery, highlights, searchMatches, targetHighlightId]);

  const ensureHighlight = useCallback(async () => {
    if (!entry || !selection) throw new Error("请先选择 EPUB 文字");
    const existing = highlights.find((item) => item.anchor.chapterPath === selection.anchor.chapterPath
      && item.anchor.start === selection.anchor.start && item.anchor.end === selection.anchor.end);
    if (existing) return existing;
    const created = await addLocalEpubHighlight(entry.id, selection.anchor);
    setHighlights((current) => [...current, created]);
    setTargetHighlightId(created.id);
    return created;
  }, [entry, highlights, selection]);

  const saveHighlight = useCallback(async () => {
    setActionBusy(true);
    try {
      await ensureHighlight();
      iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
      setSelection(null);
      setAnnotationOpen(true);
    } finally { setActionBusy(false); }
  }, [ensureHighlight]);

  const createExcerpt = useCallback(async () => {
    if (!onCreateExcerpt || !entry || !book || !selection) return;
    setActionBusy(true);
    try {
      const highlight = await ensureHighlight();
      await onCreateExcerpt({
        epubId: entry.id,
        epubName: book.title,
        chapter: chapter + 1,
        chapterTitle: book.chapters[chapter].title,
        selectedText: selection.text,
        highlightId: highlight.id,
        anchor: selection.anchor,
      });
    } finally { setActionBusy(false); }
  }, [book, chapter, ensureHighlight, entry, onCreateExcerpt, selection]);

  const rememberViewportForReflow = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameDocument && frameWindow) pendingViewportAnchorRef.current = captureViewportTextAnchor(frameDocument, frameWindow);
  }, []);

  const addManualLineMerge = useCallback(() => {
    if (!book || !selection?.lineMergeBoundary) return;
    rememberViewportForReflow();
    const fix: LocalEpubLineMerge = {
      id: globalThis.crypto?.randomUUID?.() ?? `merge-${Date.now().toString(36)}`,
      chapterPath: book.chapters[chapter].path,
      ...selection.lineMergeBoundary,
      createdAt: new Date().toISOString(),
    };
    setManualLineMerges((current) => [...current, fix]);
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
    setSelection(null);
    showSwipeNotice("已合并此处断行");
  }, [book, chapter, rememberViewportForReflow, selection, showSwipeNotice]);

  const removeManualLineMerge = useCallback((id: string) => {
    rememberViewportForReflow();
    setManualLineMerges((current) => current.filter((fix) => fix.id !== id));
  }, [rememberViewportForReflow]);

  const toggleBookmark = useCallback(async () => {
    if (!entry || !book) return;
    const existing = bookmarks.find((item) => item.chapter === chapter);
    if (existing) {
      await deleteLocalEpubBookmark(existing.id);
      setBookmarks((current) => current.filter((item) => item.id !== existing.id));
      return;
    }
    const created = await addLocalEpubBookmark({
      epubId: entry.id,
      chapter,
      chapterPath: book.chapters[chapter].path,
      scrollProgress,
      label: `${book.chapters[chapter].title} · ${Math.round(scrollProgress * 100)}%`,
    });
    setBookmarks((current) => [...current, created]);
  }, [book, bookmarks, chapter, entry, scrollProgress]);

  const toggleFullscreen = useCallback(async () => {
    const reader = readerRef.current;
    if (!reader) return;
    if (!fullscreen) {
      setTocOpen(false);
      setBookmarkPanelOpen(false);
      setAnnotationOpen(false);
      setLineMergePanelOpen(false);
      hideFocusControls();
    }
    if (fullscreen && !document.fullscreenElement) {
      hideFocusControls();
      setFullscreen(false);
      onFullscreenChange?.(false);
      return;
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (!fullscreen && (standalone || window.matchMedia("(max-width: 768px)").matches)) {
      setFullscreen(true);
      onFullscreenChange?.(true);
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (isTauriRuntime()) {
        const active = await toggleTauriFullscreen();
        if (active === null) throw new Error("Tauri fullscreen unavailable");
        setFullscreen(active);
        onFullscreenChange?.(active);
      }
      else if (reader.requestFullscreen) await reader.requestFullscreen();
      else throw new Error("Fullscreen API unavailable");
    } catch {
      setFullscreen((value) => {
        onFullscreenChange?.(!value);
        return !value;
      });
    }
  }, [fullscreen, hideFocusControls, onFullscreenChange]);

  useEffect(() => {
    const update = () => {
      const active = document.fullscreenElement === readerRef.current;
      if (!active) hideFocusControls();
      setFullscreen(active);
      onFullscreenChange?.(active);
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [hideFocusControls, onFullscreenChange]);

  const activeHighlight = highlights.find((item) => item.id === targetHighlightId) ?? null;
  const currentBookmark = bookmarks.some((item) => item.chapter === chapter);

  const startThemeLongPress = (value: LocalEpubEntry["theme"]) => {
    if (themeLongPressTimerRef.current !== null) window.clearTimeout(themeLongPressTimerRef.current);
    themeLongPressTriggeredRef.current = false;
    themeLongPressTimerRef.current = window.setTimeout(() => {
      themeLongPressTriggeredRef.current = true;
      setTheme(value);
      setColorPaletteTheme(value);
      themeLongPressTimerRef.current = null;
    }, 500);
  };

  const endThemeLongPress = () => {
    if (themeLongPressTimerRef.current !== null) window.clearTimeout(themeLongPressTimerRef.current);
    themeLongPressTimerRef.current = null;
  };

  const renderTocItems = (items: EpubTocItem[], depth = 0, parentId = "toc"): ReactNode => items.map((item, index) => {
    const nodeId = `${parentId}/${index}:${item.href}`;
    const itemChapter = book?.chapters.findIndex((candidate) => candidate.path === item.path) ?? -1;
    const hasChildren = item.children.length > 0;
    const collapsed = collapsedTocItems.has(nodeId);
    return (
      <div className="pdf-outline-node epub-toc-node" key={nodeId}>
        <div className="epub-toc-row" style={{ paddingInlineStart: `${4 + depth * 14}px` }}>
          {hasChildren
            ? <button type="button" className="epub-toc-disclosure" aria-label={`${collapsed ? "展开" : "折叠"} ${item.label}`} aria-expanded={!collapsed} onClick={() => setCollapsedTocItems((current) => {
              const next = new Set(current);
              if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
              return next;
            })}>{collapsed ? "▸" : "▾"}</button>
            : <span className="epub-toc-disclosure-placeholder" />}
          <button type="button" className={`epub-toc-link${itemChapter === chapter ? " active" : ""}`} onClick={() => navigateTo(item.path, item.fragment)}>{item.label}</button>
        </div>
        {hasChildren && !collapsed && renderTocItems(item.children, depth + 1, nodeId)}
      </div>
    );
  });

  return (
    <section ref={readerRef} className={`pdf-reader epub-reader epub-theme-${theme}${fullscreen ? " epub-reader-focus" : ""}${focusControlsVisible ? " epub-focus-controls-visible" : ""}`} aria-label="EPUB 阅读器">
      <header className="pdf-reader-toolbar epub-reader-toolbar">
        <button type="button" className="pdf-reader-close" onClick={closeReader} aria-label="关闭 EPUB 阅读器">←</button>
        <strong className="pdf-reader-title" title={entry?.name}>{book?.title ?? entry?.name ?? "EPUB 阅读器"}</strong>
        <div className="pdf-page-controls epub-chapter-controls">
          <button type="button" onClick={() => changeChapter(chapter - 1)} disabled={!book || chapter <= 0}>‹</button>
          <span>{book ? `${chapter + 1}/${book.chapters.length}` : "–/–"}</span>
          <button type="button" onClick={() => changeChapter(chapter + 1)} disabled={!book || chapter >= book.chapters.length - 1}>›</button>
        </div>
        <div className="epub-font-controls" aria-label="EPUB 字号">
          <button type="button" onClick={() => setFontSize((size) => Math.max(70, size - 10))} disabled={fontSize <= 70}>A−</button>
          <span>{fontSize}%</span>
          <button type="button" onClick={() => setFontSize((size) => Math.min(180, size + 10))} disabled={fontSize >= 180}>A＋</button>
        </div>
        <div className="epub-theme-controls" aria-label="EPUB 主题">
          {(["light", "sepia", "dark"] as const).map((value) => (
            <button key={value} type="button" className={theme === value ? "active" : ""} onPointerDown={() => startThemeLongPress(value)} onPointerUp={endThemeLongPress} onPointerCancel={endThemeLongPress} onPointerLeave={endThemeLongPress} onContextMenu={(event) => event.preventDefault()} onClick={() => {
              if (themeLongPressTriggeredRef.current) { themeLongPressTriggeredRef.current = false; return; }
              setTheme(value);
            }} aria-label={`${value === "light" ? "浅色" : value === "sepia" ? "护眼" : "深色"}主题`}>
              {value === "light" ? "☀" : value === "sepia" ? "◐" : "☾"}
            </button>
          ))}
        </div>
        <button type="button" className={smartLineMerge ? "active epub-line-merge-toggle" : "epub-line-merge-toggle"} aria-pressed={smartLineMerge} aria-label="智能合并 EPUB 硬换行" title="智能合并硬换行" onClick={() => { rememberViewportForReflow(); setSmartLineMerge((enabled) => !enabled); }}>断行</button>
        <button type="button" className={lineMergePanelOpen ? "active epub-line-merge-toggle" : "epub-line-merge-toggle"} aria-label="管理 EPUB 人工断行修复" onClick={() => setLineMergePanelOpen((open) => !open)}>修复{manualLineMerges.length ? ` ${manualLineMerges.length}` : ""}</button>
        <form className="pdf-search epub-search" role="search" onSubmit={(event) => { event.preventDefault(); runSearch(1); }}>
          <input
            type="search"
            aria-label="搜索 EPUB"
            placeholder="搜索全文"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button type="button" aria-label="上一个 EPUB 搜索结果" disabled={searchMatches.length === 0} onClick={() => runSearch(-1)}>↑</button>
          <button type="submit" aria-label="下一个 EPUB 搜索结果">↓</button>
          <span>{completedSearchQuery ? (searchMatches.length > 0 ? `${activeSearchIndex + 1}/${searchMatches.length}` : "未找到") : ""}</span>
        </form>
        <button type="button" className={tocOpen ? "active" : ""} onClick={() => setTocOpen((open) => !open)} aria-label="EPUB 目录">目录</button>
        <button type="button" className={bookmarkPanelOpen || currentBookmark ? "active" : ""} onClick={() => setBookmarkPanelOpen(true)} aria-label="打开 EPUB 书签">🔖{bookmarks.length > 0 ? ` ${bookmarks.length}` : ""}</button>
        <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "退出 EPUB 专注模式" : "进入 EPUB 专注模式"}>⛶</button>
      </header>
      <div className="pdf-reader-body">
        {tocOpen && book && (
          <aside className="pdf-outline epub-outline" aria-label="EPUB 目录">
            <div className="pdf-outline-heading">
              <strong>目录</strong>
              <div className="epub-outline-actions">
                <span>{progress}%</span>
                <button type="button" aria-label="展开全部 EPUB 目录" onClick={() => setCollapsedTocItems(new Set())}>＋</button>
                <button type="button" aria-label="折叠全部 EPUB 目录" onClick={() => setCollapsedTocItems(new Set(collapsibleTocItems))}>−</button>
              </div>
            </div>
            <div className="pdf-outline-list">
              {renderTocItems(tocTree)}
              {(highlights.length > 0 || bookmarks.length > 0) && <div className="epub-annotation-directory">
                <h4>高亮与备注</h4>
                {highlights.map((highlight) => (
                  <div className="epub-annotation-item" key={highlight.id}>
                    <button type="button" onClick={() => {
                      const targetChapter = book.chapters.findIndex((item) => item.path === highlight.anchor.chapterPath);
                      if (targetChapter >= 0) { setChapter(targetChapter); setTargetHighlightId(highlight.id); }
                      setAnnotationOpen(true);
                    }}>{highlight.anchor.exact}</button>
                    <button type="button" aria-label={`删除高亮 ${highlight.anchor.exact}`} onClick={() => void deleteLocalEpubHighlight(highlight.id).then(() => setHighlights((current) => current.filter((item) => item.id !== highlight.id)))}>×</button>
                  </div>
                ))}
                <h4>书签</h4>
                {bookmarks.map((bookmark) => (
                  <div className="epub-annotation-item" key={bookmark.id}>
                    <button type="button" onClick={() => { setChapter(bookmark.chapter); setFragment(undefined); setScrollProgress(bookmark.scrollProgress); }}>{bookmark.label}</button>
                    <button type="button" aria-label={`删除书签 ${bookmark.label}`} onClick={() => void deleteLocalEpubBookmark(bookmark.id).then(() => setBookmarks((current) => current.filter((item) => item.id !== bookmark.id)))}>×</button>
                  </div>
                ))}
              </div>}
            </div>
          </aside>
        )}
        <main className="epub-reading-viewport">
          {loading && <div className="pdf-reader-message">正在打开 EPUB…</div>}
          {displayError && <div className="pdf-reader-message pdf-reader-error"><strong>无法打开 EPUB</strong><span>{displayError}</span></div>}
          {!loading && !displayError && chapterResult.html && (
            <iframe
              ref={iframeRef}
              className="epub-chapter-frame"
              title={book?.chapters[chapter].title ?? "EPUB 章节"}
              sandbox="allow-same-origin"
              srcDoc={chapterResult.html}
              onLoad={handleFrameLoad}
            />
          )}
          {!loading && !displayError && book && (
            <nav className="epub-bottom-navigation" aria-label="EPUB 章节导航">
              <button type="button" onClick={() => { showFocusControls(); changeChapter(chapter - 1); }} disabled={chapter <= 0}>← 上一章</button>
              <span>{book.chapters[chapter].title} · {progress}%</span>
              <button type="button" onClick={() => { showFocusControls(); changeChapter(chapter + 1); }} disabled={chapter >= book.chapters.length - 1}>下一章 →</button>
            </nav>
          )}
        </main>
      </div>
      {fullscreen && <button type="button" className="epub-focus-exit" onClick={() => void toggleFullscreen()} aria-label="退出 EPUB 专注模式">↙️</button>}
      {swipeNotice && <div className="epub-swipe-notice" role="status">{swipeNotice}</div>}
      {colorPaletteTheme && (
        <aside className="epub-background-palette" role="dialog" aria-modal="true" aria-label="EPUB 背景色板">
          <header><strong>自定义{colorPaletteTheme === "light" ? "浅色" : colorPaletteTheme === "sepia" ? "护眼" : "深色"}背景</strong><button type="button" aria-label="关闭 EPUB 背景色板" onClick={() => setColorPaletteTheme(null)}>×</button></header>
          <div className="epub-background-swatches">
            {EPUB_BACKGROUND_PRESETS.map((color) => <button key={color} type="button" aria-label={`选择背景色 ${color}`} className={themeBackgrounds[colorPaletteTheme] === color ? "active" : ""} style={{ backgroundColor: color }} onClick={() => setThemeBackgrounds((current) => ({ ...current, [colorPaletteTheme]: color }))} />)}
          </div>
          <label>自定义颜色<input type="color" aria-label="自定义 EPUB 背景色" value={themeBackgrounds[colorPaletteTheme] ?? EPUB_THEME_DEFAULT_BACKGROUNDS[colorPaletteTheme]} onChange={(event) => setThemeBackgrounds((current) => ({ ...current, [colorPaletteTheme]: event.target.value }))} /></label>
          <button type="button" onClick={() => setThemeBackgrounds((current) => {
            const next = { ...current };
            delete next[colorPaletteTheme];
            return next;
          })}>恢复该主题默认背景</button>
        </aside>
      )}
      {selection && (
        <div className="epub-selection-actions">
          <span>{selection.text.length} 字</span>
          {selection.lineMergeBoundary && <button type="button" disabled={actionBusy} onClick={addManualLineMerge}>合并此处断行</button>}
          <button type="button" disabled={actionBusy} onClick={() => void saveHighlight()}>高亮</button>
          {onCreateExcerpt && <button type="button" disabled={actionBusy} onClick={() => void createExcerpt()}>摘录到笔记</button>}
        </div>
      )}
      {lineMergePanelOpen && (
        <aside className="epub-line-merge-panel" role="dialog" aria-modal="true" aria-label="EPUB 人工断行修复">
          <header><strong>人工断行修复</strong><button type="button" aria-label="关闭 EPUB 人工断行修复" onClick={() => setLineMergePanelOpen(false)}>×</button></header>
          <p>跨断行选中前后文字，再点击“合并此处断行”。修复只影响阅读显示。</p>
          <div className="epub-line-merge-list">
            {manualLineMerges.length === 0 && <span>还没有人工修复</span>}
            {manualLineMerges.map((fix) => <div key={fix.id}>
              <button type="button" onClick={() => {
                const targetChapter = book?.chapters.findIndex((item) => item.path === fix.chapterPath) ?? -1;
                if (targetChapter >= 0) setChapter(targetChapter);
                setLineMergePanelOpen(false);
              }}>{fix.left.slice(-24)} <b>⌁</b> {fix.right.slice(0, 24)}</button>
              <button type="button" aria-label={`撤销断行修复 ${fix.left.slice(-12)}`} onClick={() => removeManualLineMerge(fix.id)}>×</button>
            </div>)}
          </div>
        </aside>
      )}
      {annotationOpen && activeHighlight && (
        <aside className="epub-note-popover" aria-label="EPUB 高亮备注">
          <strong>{activeHighlight.anchor.exact}</strong>
          <label>颜色<input type="color" value={activeHighlight.color} onChange={(event) => void updateLocalEpubHighlight(activeHighlight.id, { color: event.target.value }).then((updated) => setHighlights((current) => current.map((item) => item.id === updated.id ? updated : item)))} /></label>
          <textarea aria-label="EPUB 高亮备注" defaultValue={activeHighlight.note ?? ""} placeholder="添加备注…" onBlur={(event) => void updateLocalEpubHighlight(activeHighlight.id, { note: event.target.value }).then((updated) => setHighlights((current) => current.map((item) => item.id === updated.id ? updated : item)))} />
          <button type="button" onClick={() => setAnnotationOpen(false)}>完成</button>
        </aside>
      )}
      {bookmarkPanelOpen && book && (
        <aside className="epub-bookmark-popover" role="dialog" aria-modal="true" aria-label="EPUB 书签">
          <header>
            <strong>书签</strong>
            <button type="button" onClick={() => setBookmarkPanelOpen(false)} aria-label="关闭 EPUB 书签">×</button>
          </header>
          <button type="button" className="epub-bookmark-current" onClick={() => void toggleBookmark()}>
            {currentBookmark ? "取消本章书签" : "添加当前位置书签"}
          </button>
          <div className="epub-bookmark-list">
            {bookmarks.length === 0 && <p>还没有书签</p>}
            {bookmarks.map((bookmark) => (
              <div className="epub-annotation-item" key={bookmark.id}>
                <button type="button" onClick={() => {
                  setChapter(bookmark.chapter);
                  setFragment(undefined);
                  setScrollProgress(bookmark.scrollProgress);
                  setBookmarkPanelOpen(false);
                }}>{bookmark.label}</button>
                <button type="button" aria-label={`删除书签 ${bookmark.label}`} onClick={() => void deleteLocalEpubBookmark(bookmark.id).then(() => setBookmarks((current) => current.filter((item) => item.id !== bookmark.id)))}>×</button>
              </div>
            ))}
          </div>
        </aside>
      )}
    </section>
  );
}

export default EpubReader;
