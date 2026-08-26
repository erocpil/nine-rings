import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getLocalEpub,
  parseEpubArchiveAsync,
  resolveEpubPath,
  updateLocalEpubProgress,
  type EpubTocItem,
  type LocalEpubEntry,
  type ParsedEpub,
} from "../lib/epub-library";

interface Props {
  documentId: string;
  onClose: () => void;
}

interface FlatTocItem extends EpubTocItem {
  depth: number;
}

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

function mimeForPath(path: string): string {
  return MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

function flattenToc(items: EpubTocItem[], depth = 0): FlatTocItem[] {
  return items.flatMap((item) => [{ ...item, depth }, ...flattenToc(item.children, depth + 1)]);
}

function chapterPlainText(book: ParsedEpub, chapter: number): string {
  const bytes = book.files[book.chapters[chapter].path];
  if (!bytes) return "";
  const source = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script, style").forEach((node) => node.remove());
  return document.body.textContent ?? "";
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

  const palettes = {
    light: { background: "#fffdf9", text: "#25231f", link: "#315f9b" },
    sepia: { background: "#f4ecd8", text: "#403629", link: "#7b542c" },
    dark: { background: "#202124", text: "#e8eaed", link: "#8ab4f8" },
  } as const;
  const palette = palettes[theme];
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
  `;
  (document.head ?? document.documentElement.insertBefore(document.createElement("head"), document.documentElement.firstChild)).appendChild(style);
  return `<!doctype html>${new XMLSerializer().serializeToString(document.documentElement)}`;
}

export function EpubReader({ documentId, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const registryRef = useRef<ReturnType<typeof createResourceRegistry> | null>(null);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const [entry, setEntry] = useState<LocalEpubEntry | null>(null);
  const [book, setBook] = useState<ParsedEpub | null>(null);
  const [chapter, setChapter] = useState(0);
  const [fragment, setFragment] = useState<string | undefined>();
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<LocalEpubEntry["theme"]>("light");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [completedSearchQuery, setCompletedSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<EpubSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [tocOpen, setTocOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getLocalEpub(documentId).then(async (stored) => {
      if (!stored) throw new Error("EPUB 不存在或已经被删除");
      const parsed = await parseEpubArchiveAsync(await stored.blob.arrayBuffer());
      if (cancelled) return;
      registryRef.current?.destroy();
      registryRef.current = createResourceRegistry(parsed);
      setEntry(stored.entry);
      setBook(parsed);
      const savedChapter = Math.max(0, Math.min(parsed.chapters.length - 1, stored.entry.chapter));
      setChapter(savedChapter);
      const savedLocation = stored.entry.location?.split("#", 2);
      setFragment(savedLocation?.[0] === parsed.chapters[savedChapter].path ? savedLocation[1] : undefined);
      setFontSize(stored.entry.fontSize || 100);
      setTheme(stored.entry.theme || "light");
      setScrollProgress(stored.entry.scrollProgress ?? 0);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
      registryRef.current?.destroy();
      registryRef.current = null;
    };
  }, [documentId]);

  const chapterResult = useMemo(() => {
    if (!book || !registryRef.current) return { html: "", error: null as string | null };
    try {
      return { html: safeChapterDocument(book, book.chapters[chapter].path, registryRef.current.resourceUrl, fontSize, theme), error: null };
    } catch (reason) {
      return { html: "", error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [book, chapter, fontSize, theme]);
  const displayError = error ?? chapterResult.error;

  const flatToc = useMemo(() => flattenToc(book?.toc ?? []), [book]);
  const progress = book ? Math.round((chapter + 1) / book.chapters.length * 100) : 0;

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
        const text = chapterPlainText(book, chapterIndex).toLocaleLowerCase();
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
  }, [activeSearchIndex, book, completedSearchQuery, searchMatches, searchQuery]);

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

  const persistProgress = useCallback(async () => {
    if (!entry || !book) return;
    const current = book.chapters[chapter];
    await updateLocalEpubProgress(entry.id, {
      chapter,
      location: `${current.path}${fragment ? `#${fragment}` : ""}`,
      fontSize,
      theme,
      scrollProgress,
    });
  }, [book, chapter, entry, fontSize, fragment, scrollProgress, theme]);

  useEffect(() => {
    void persistProgress().catch((reason) => console.warn("[EPUB] 保存阅读进度失败:", reason));
  }, [persistProgress]);

  const closeReader = useCallback(() => {
    void persistProgress()
      .catch((reason) => console.warn("[EPUB] 保存最终阅读进度失败:", reason))
      .finally(onClose);
  }, [onClose, persistProgress]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeReader();
      else if (event.key === "ArrowLeft" || event.key === "PageUp") setChapter((value) => Math.max(0, value - 1));
      else if (event.key === "ArrowRight" || event.key === "PageDown") setChapter((value) => book ? Math.min(book.chapters.length - 1, value + 1) : value);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [book, closeReader]);

  const handleFrameLoad = () => {
    const frameDocument = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameDocument || !frameWindow || !book) return;
    const chapterSearchMatches = searchMatches.filter((match) => match.chapter === chapter);
    const activeMatch = searchMatches[activeSearchIndex];
    const activeOccurrence = activeMatch?.chapter === chapter
      ? chapterSearchMatches.findIndex((match) => match === activeMatch)
      : -1;
    const activeMark = markFrameSearch(frameDocument, completedSearchQuery, activeOccurrence);
    if (activeMark) activeMark.scrollIntoView({ block: "center" });
    else if (fragment) frameDocument.getElementById(fragment)?.scrollIntoView();
    else if (scrollProgress > 0) {
      window.requestAnimationFrame(() => frameWindow.scrollTo(0, scrollProgress * Math.max(0, frameDocument.documentElement.scrollHeight - frameWindow.innerHeight)));
    }
    frameWindow.addEventListener("scroll", () => {
      if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = window.setTimeout(() => {
        const maximum = Math.max(0, frameDocument.documentElement.scrollHeight - frameWindow.innerHeight);
        setScrollProgress(maximum > 0 ? frameWindow.scrollY / maximum : 0);
      }, 160);
    }, { passive: true });
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
    markFrameSearch(frameDocument, completedSearchQuery, activeOccurrence)?.scrollIntoView({ block: "center" });
  }, [activeSearchIndex, chapter, completedSearchQuery, searchMatches]);

  return (
    <section className={`pdf-reader epub-reader epub-theme-${theme}`} aria-label="EPUB 阅读器">
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
            <button key={value} type="button" className={theme === value ? "active" : ""} onClick={() => setTheme(value)} aria-label={`${value === "light" ? "浅色" : value === "sepia" ? "护眼" : "深色"}主题`}>
              {value === "light" ? "☀" : value === "sepia" ? "◐" : "☾"}
            </button>
          ))}
        </div>
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
      </header>
      <div className="pdf-reader-body">
        {tocOpen && book && (
          <aside className="pdf-outline epub-outline" aria-label="EPUB 目录">
            <div className="pdf-outline-heading">
              <strong>目录</strong>
              <span>{progress}%</span>
            </div>
            <div className="pdf-outline-list">
              {(flatToc.length > 0 ? flatToc : book.chapters.map((item) => ({ label: item.title, path: item.path, href: item.path, fragment: undefined, children: [], depth: 0 }))).map((item, index) => {
                const itemChapter = book.chapters.findIndex((candidate) => candidate.path === item.path);
                return (
                  <div className="pdf-outline-node" key={`${item.href}-${index}`}>
                    <button type="button" className={itemChapter === chapter ? "active" : ""} style={{ paddingInlineStart: `${10 + item.depth * 14}px` }} onClick={() => navigateTo(item.path, item.fragment)}>
                      {item.label}
                    </button>
                  </div>
                );
              })}
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
              <button type="button" onClick={() => changeChapter(chapter - 1)} disabled={chapter <= 0}>← 上一章</button>
              <span>{book.chapters[chapter].title} · {progress}%</span>
              <button type="button" onClick={() => changeChapter(chapter + 1)} disabled={chapter >= book.chapters.length - 1}>下一章 →</button>
            </nav>
          )}
        </main>
      </div>
    </section>
  );
}

export default EpubReader;
