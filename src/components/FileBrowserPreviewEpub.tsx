import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  parseEpubArchiveAsync,
  resolveEpubPath,
  type EpubTocItem,
  type ParsedEpub,
} from "../lib/epub-library";
import { createResourceRegistry, safeChapterDocument } from "./EpubReader";
import { browserSettings } from "../lib/local-files/browser-settings";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import {
  readReaderPreviewState,
  saveReaderPreviewState,
} from "../lib/local-files/reader-preview-state";
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
    } catch {
      setNotice("无法保存阅读位置，本次阅读仍可继续。");
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    const abort = new AbortController();
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
      "light",
      undefined,
      false,
      [],
      false,
    );
    return source.replace(
      /<head([^>]*)>/i,
      "<head$1><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob: data:; style-src blob: 'unsafe-inline'; font-src blob: data:; media-src blob:;\">",
    );
  }, [book, resources, chapter, font]);
  const go = (index: number, fragment?: string) => {
    if (!book || index < 0 || index >= book.chapters.length) return;
    persist();
    restored.current = false;
    top.current = 0;
    if (index === chapter) {
      frame.current?.contentWindow?.scrollTo(0, 0);
      if (fragment)
        frame.current?.contentDocument
          ?.getElementById(fragment)
          ?.scrollIntoView();
      restored.current = true;
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
      if (index >= 0) go(index, target.fragment);
    };
    const key = (event: KeyboardEvent) => {
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
    binding.current = () => {
      closed = true;
      clearTimeout(timer);
      win.removeEventListener("scroll", scroll);
      doc.removeEventListener("click", click);
      doc.removeEventListener("keydown", key);
    };
  };
  return (
    <div className="file-browser-epub-preview">
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
          title="EPUB 内容"
          ref={frame}
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={loaded}
        />
      )}
    </div>
  );
}
