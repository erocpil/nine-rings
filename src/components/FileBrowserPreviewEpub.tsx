import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  parseEpubArchiveAsync,
  resolveEpubPath,
  type EpubTocItem,
  type ParsedEpub,
} from "../lib/epub-library";
import {
  createResourceRegistry,
  safeChapterDocument,
  markFrameSearch,
} from "./EpubReader";
import { browserSettings } from "../lib/local-files/browser-settings";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import {
  readReaderPreviewState,
  saveReaderPreviewState,
} from "../lib/local-files/reader-preview-state";
import { useReaderPreviewNavigation } from "./ReaderPreviewNavigation";
import { browserPreviewMatches } from "../lib/local-files/browser-preview";
import { ToolbarIcon } from "./ToolbarIcon";

/** Device-local archive projection: no import, library identity or writable book. */
export function FileBrowserPreviewEpub({
  blob,
  identity,
  settings = browserSettings(),
  fallback,
  onEscape,
}: {
  blob: Blob;
  identity: string;
  settings?: BrowserSettingsStore;
  fallback?: ReactNode;
  onEscape?: () => void;
}) {
  const [frameReady, setFrameReady] = useState(false);
  const [book, setBook] = useState<ParsedEpub | null>(null),
    [chapter, setChapter] = useState(0),
    [font, setFont] = useState(100);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [notice, setNotice] = useState("");
  const frame = useRef<HTMLIFrameElement>(null),
    controller = useRef<AbortController | null>(null),
    fingerprint = useRef("");
  const top = useRef(0),
    binding = useRef<() => void>(() => {}),
    restored = useRef(false);
  const live = useRef({ chapter, font, settings, identity, book });
  live.current = { chapter, font, settings, identity, book };
  const reading = useReaderPreviewNavigation(
    settings,
    identity,
    fingerprint.current,
    () => ({
      page: live.current.chapter + 1,
      top: top.current,
      label: live.current.book?.chapters[live.current.chapter]?.title,
    }),
    (point) => go(point.page - 1, undefined, point.top, false),
  );
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      Array<{ chapter: number; occurrence: number; snippet: string }>
    >([]),
    [searching, setSearching] = useState(false),
    [scanned, setScanned] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null),
    queryRef = useRef(query);
  queryRef.current = query;
  const searchEpoch = useRef(0),
    selectedSearch = useRef<{ query: string; occurrence: number } | null>(null);
  const [footnote, setFootnote] = useState<{
    text: string;
    chapter: number;
    fragment: string;
  } | null>(null);
  const footnoteRef = useRef(footnote);
  footnoteRef.current = footnote;
  const find = async () => {
    const epoch = ++searchEpoch.current,
      needle = query.trim();
    setResults([]);
    setScanned(0);
    if (!book || !needle) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const found: typeof results = [];
    for (let index = 0; index < book.chapters.length; index++) {
      if (searchEpoch.current !== epoch) return;
      const doc = new DOMParser().parseFromString(
        new TextDecoder().decode(book.files[book.chapters[index].path]),
        "text/html",
      );
      doc.querySelectorAll("script,style").forEach((node) => node.remove());
      const text = doc.body.textContent ?? "";
      let occurrence = 0;
      for (const match of browserPreviewMatches(text, needle).matches) {
        if (found.length >= 1000) break;
        found.push({
          chapter: index,
          occurrence: occurrence++,
          snippet: text.slice(Math.max(0, match.from - 30), match.to + 60),
        });
      }
      setResults([...found]);
      setScanned(index + 1);
      if (found.length >= 1000) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (searchEpoch.current === epoch) setSearching(false);
  };
  const persist = () => {
    if (!fingerprint.current || !live.current.book) return;
    const value = live.current;
    try {
      saveReaderPreviewState(value.settings, value.identity, {
        fingerprint: fingerprint.current,
        page: value.chapter + 1,
        zoom: 0,
        top: top.current,
        left: 0,
        font: value.font,
      });
      reading.update({
        chapters: {
          ...reading.extras.chapters,
          [String(value.chapter)]: top.current,
        },
      });
    } catch {
      setNotice("无法保存阅读位置，本次阅读仍可继续。");
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    const abort = new AbortController(),
      searches = searchEpoch;
    controller.current = abort;
    void (async () => {
      const bytes = await blob.arrayBuffer();
      abort.signal.throwIfAborted();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      abort.signal.throwIfAborted();
      fingerprint.current = Array.from(new Uint8Array(hash), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      const parsed = await parseEpubArchiveAsync(
        bytes,
        abort.signal,
        64 * 1024 * 1024,
      );
      abort.signal.throwIfAborted();
      const state = readReaderPreviewState(
        live.current.settings,
        identity,
        fingerprint.current,
      );
      top.current = state.top;
      setFont(state.font);
      setChapter(Math.min(state.page - 1, parsed.chapters.length - 1));
      setBook(parsed);
      setBusy(false);
    })().catch((cause) => {
      if (!abort.signal.aborted) {
        setError(String(cause));
        setBusy(false);
      }
    });
    return () => {
      binding.current();
      searches.current++;
      persistRef.current();
      abort.abort();
    };
  }, [blob, identity]);
  const resources = useMemo(
    () => (book ? createResourceRegistry(book) : null),
    [book],
  );
  useEffect(() => () => resources?.destroy(), [resources]);
  const toc = useMemo(() => {
    const items: Array<{
      label: string;
      path: string;
      fragment?: string;
      depth: number;
    }> = [];
    const visit = (nodes: EpubTocItem[], depth: number) => {
      for (const item of nodes) {
        if (items.length >= 1000 || depth > 12) break;
        items.push({ ...item, depth });
        visit(item.children, depth + 1);
      }
    };
    if (book) {
      visit(book.toc, 0);
      if (!items.length)
        book.chapters.forEach((item) =>
          items.push({ label: item.title, path: item.path, depth: 0 }),
        );
    }
    return items;
  }, [book]);
  const html = useMemo(() => {
    if (!book || !resources) return "";
    // Reuse the reader sanitizer; sandbox excludes archive scripts and network access.
    const source = safeChapterDocument(
      book,
      book.chapters[chapter].path,
      resources.resourceUrl,
      font,
      100,
      reading.extras.theme,
      undefined,
      false,
      [],
      false,
    );
    const layout = `<style>body{line-height:${reading.extras.lineHeight}!important;padding-left:${reading.extras.margin}vw!important;padding-right:${reading.extras.margin}vw!important}</style>`;
    return source
      .replace("</head>", `${layout}</head>`)
      .replace(
        /<head([^>]*)>/i,
        "<head$1><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; img-src blob: data:; style-src blob: 'unsafe-inline'; font-src blob: data:; media-src blob:;\">",
      );
  }, [
    book,
    resources,
    chapter,
    font,
    reading.extras.theme,
    reading.extras.lineHeight,
    reading.extras.margin,
  ]);
  useLayoutEffect(() => setFrameReady(false), [html]);
  const go = (
    index: number,
    fragment?: string,
    destinationTop?: number,
    track = true,
  ) => {
    if (!book || index < 0 || index >= book.chapters.length) return;
    if (track) reading.record();
    persist();
    restored.current = false;
    top.current =
      destinationTop ??
      (fragment ? 0 : (reading.extras.chapters[String(index)] ?? 0));
    if (index === chapter) {
      frame.current?.contentWindow?.scrollTo(0, top.current);
      if (fragment)
        frame.current?.contentDocument
          ?.getElementById(fragment)
          ?.scrollIntoView();
      restored.current = true;
      if (selectedSearch.current) {
        const selected = selectedSearch.current;
        markFrameSearch(
          frame.current!.contentDocument!,
          selected.query,
          selected.occurrence,
        )?.scrollIntoView({ block: "center" });
        selectedSearch.current = null;
      }
    } else {
      fragmentRef.current = fragment ?? "";
      setChapter(index);
    }
  };
  const fragmentRef = useRef("");
  const loaded = () => {
    binding.current();
    const doc = frame.current?.contentDocument,
      win = frame.current?.contentWindow;
    if (!doc || !win) return;
    let timer: ReturnType<typeof setTimeout>,
      closed = false;
    const restore = async () => {
      await doc.fonts.ready;
      await Promise.all(
        Array.from(doc.images).map((img) => img.decode?.().catch(() => {})),
      );
      if (closed) return;
      win.scrollTo(0, top.current);
      if (fragmentRef.current)
        doc.getElementById(fragmentRef.current)?.scrollIntoView();
      fragmentRef.current = "";
      restored.current = true;
      if (selectedSearch.current) {
        const selected = selectedSearch.current;
        markFrameSearch(
          doc,
          selected.query,
          selected.occurrence,
        )?.scrollIntoView({ block: "center" });
        selectedSearch.current = null;
      }
    };
    void restore();
    const scroll = () => {
      if (!restored.current) return;
      top.current = win.scrollY;
      clearTimeout(timer);
      timer = setTimeout(() => persistRef.current(), 250);
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]");
      if (!link || !book) return;
      event.preventDefault();
      const href = link.getAttribute("href")!;
      if (/^(?:[a-z]+:|\/\/)/i.test(href)) return;
      const target = resolveEpubPath(book.chapters[chapter].path, href);
      const index = book.chapters.findIndex(
        (item) => item.path === target.path,
      );
      if (target.fragment) {
        const source = book.files[target.path];
        const noteDoc = source
          ? new DOMParser().parseFromString(
              new TextDecoder().decode(source),
              "text/html",
            )
          : null;
        const note = noteDoc?.getElementById(target.fragment);
        if (
          note &&
          (/noteref/.test(link.getAttribute("epub:type") ?? "") ||
            link.getAttribute("role") === "doc-noteref" ||
            /footnote|endnote/.test(
              note.getAttribute("epub:type") ?? note.getAttribute("role") ?? "",
            ))
        ) {
          setFootnote({
            text: note.textContent ?? "",
            chapter: index,
            fragment: target.fragment,
          });
          return;
        }
      }
      if (index >= 0) go(index, target.fragment);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (event.key === "Escape" && footnoteRef.current) {
        event.preventDefault();
        setFootnote(null);
        return;
      }
      if (event.key === "Escape" && queryRef.current) {
        event.preventDefault();
        searchEpoch.current++;
        setQuery("");
        setResults([]);
        setSearching(false);
        markFrameSearch(doc, "", 0);
        return;
      }
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "ArrowRight") {
        event.preventDefault();
        go(chapter + 1);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        go(chapter - 1);
      }
    };
    win.addEventListener("scroll", scroll);
    doc.addEventListener("click", click);
    doc.addEventListener("keydown", key);
    setFrameReady(true);
    binding.current = () => {
      closed = true;
      clearTimeout(timer);
      win.removeEventListener("scroll", scroll);
      doc.removeEventListener("click", click);
      doc.removeEventListener("keydown", key);
    };
  };
  return (
    <div
      className="file-browser-epub-preview"
      onKeyDownCapture={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          searchInput.current?.focus();
          return;
        }
        if (event.key === "Escape" && footnote) {
          event.preventDefault();
          event.stopPropagation();
          setFootnote(null);
        } else if (event.key === "Escape" && query) {
          event.preventDefault();
          event.stopPropagation();
          searchEpoch.current++;
          setQuery("");
          setResults([]);
          setSearching(false);
          if (frame.current?.contentDocument)
            markFrameSearch(frame.current.contentDocument, "", 0);
        }
      }}
    >
      {reading.controls}
      <div className="reader-epub-preferences">
        <label>
          行距
          <select
            aria-label="EPUB 行距"
            value={reading.extras.lineHeight}
            onChange={(event) => {
              persist();
              restored.current = false;
              reading.update({ lineHeight: Number(event.target.value) });
            }}
          >
            {[1.4, 1.6, 1.75, 2, 2.2].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          页边距
          <select
            aria-label="EPUB 页边距"
            value={reading.extras.margin}
            onChange={(event) => {
              persist();
              restored.current = false;
              reading.update({ margin: Number(event.target.value) });
            }}
          >
            {[2, 5, 8, 12].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
        <label>
          配色
          <select
            aria-label="EPUB 配色"
            value={reading.extras.theme}
            onChange={(event) => {
              persist();
              restored.current = false;
              reading.update({
                theme: event.target.value as "light" | "sepia" | "dark",
              });
            }}
          >
            <option value="light">浅色</option>
            <option value="sepia">纸色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
      <form
        className="file-browser-reader-search"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <input
          ref={searchInput}
          aria-label="EPUB 全书查找"
          value={query}
          onChange={(event) => {
            searchEpoch.current++;
            setSearching(false);
            setQuery(event.target.value);
            setResults([]);
          }}
          placeholder="全书查找"
        />
        <button type="submit" disabled={!book || !query.trim()}>
          查找
        </button>
        {searching && (
          <button
            type="button"
            onClick={() => {
              searchEpoch.current++;
              setSearching(false);
            }}
          >
            停止查找
          </button>
        )}
        {query && (
          <span role="status">
            {results.length}处
            {searching
              ? ` · 已扫描${scanned}/${book?.chapters.length}章`
              : results.length >= 1000
                ? " · 已达1000条上限"
                : ""}
          </span>
        )}
      </form>
      {results.length > 0 && (
        <div className="file-browser-reader-results" aria-label="EPUB 查找结果">
          {results.map((item, index) => (
            <button
              type="button"
              key={index}
              onClick={() => {
                selectedSearch.current = {
                  query: query.trim(),
                  occurrence: item.occurrence,
                };
                go(item.chapter);
              }}
            >
              {book?.chapters[item.chapter].title} · {item.snippet}
            </button>
          ))}
        </div>
      )}
      {footnote && (
        <aside className="reader-footnote" role="dialog" aria-label="EPUB 脚注">
          <header>
            <strong>脚注</strong>
            <button
              type="button"
              aria-label="关闭脚注"
              onClick={() => setFootnote(null)}
            >
              ×
            </button>
          </header>
          <p>{footnote.text}</p>
          {footnote.chapter >= 0 && (
            <button
              type="button"
              onClick={() => {
                go(footnote.chapter, footnote.fragment);
                setFootnote(null);
              }}
            >
              前往脚注
            </button>
          )}
        </aside>
      )}

      <div className="file-browser-preview-zoom">
        <button
          type="button"
          className="btn-icon"
          aria-label="EPUB 上一章"
          disabled={!book || chapter === 0}
          onClick={() => go(chapter - 1)}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
        <select
          aria-label="EPUB 目录"
          disabled={!book}
          value=""
          onChange={(event) => {
            const item = toc[Number(event.target.value)];
            if (!item || !book) return;
            const index = book.chapters.findIndex(
              (chapter) => chapter.path === item.path,
            );
            if (index >= 0) go(index, item.fragment);
          }}
        >
          <option value="">
            {book
              ? `${chapter + 1}/${book.chapters.length} · ${book.chapters[chapter].title}`
              : "目录"}
          </option>
          {toc.map((item, index) => (
            <option key={index} value={index}>
              {"　".repeat(item.depth)}
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-icon"
          aria-label="EPUB 下一章"
          disabled={!book || chapter === book.chapters.length - 1}
          onClick={() => go(chapter + 1)}
        >
          <ToolbarIcon name="chevronRight" />
        </button>
        <label>
          字号{" "}
          <select
            aria-label="EPUB 字号"
            value={font}
            onChange={(event) => {
              persist();
              restored.current = false;
              setFont(Number(event.target.value));
            }}
          >
            {[75, 100, 125, 150, 175, 200].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
        </label>
      </div>
      {book && (
        <div aria-label="阅读进度" className="reader-preview-progress">
          第{chapter + 1}/{book.chapters.length}章 ·{" "}
          {Math.round(((chapter + 1) / book.chapters.length) * 100)}%
        </div>
      )}
      {busy && (
        <p role="status">
          正在解析 EPUB…{" "}
          <button
            type="button"
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
              setError("已中断加载，可重新打开文件。");
            }}
          >
            中断加载
          </button>
        </p>
      )}
      {error && (
        <>
          <p role="status">无法预览此 EPUB：{error}</p>
          {fallback}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {book && (
        <iframe
          style={{ visibility: frameReady ? "visible" : "hidden" }}
          title="EPUB 内容"
          ref={frame}
          sandbox="allow-same-origin allow-scripts"
          srcDoc={html}
          onLoad={loaded}
        />
      )}
    </div>
  );
}
