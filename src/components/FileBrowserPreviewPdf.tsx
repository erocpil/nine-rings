import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ToolbarIcon } from "./ToolbarIcon";
import "pdfjs-dist/web/pdf_viewer.css";
import { browserPreviewMatches } from "../lib/local-files/browser-preview";
import { browserSettings } from "../lib/local-files/browser-settings";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import {
  readReaderPreviewState,
  saveReaderPreviewState,
} from "../lib/local-files/reader-preview-state";
GlobalWorkerOptions.workerSrc = worker;

/** Read-only, one-page-at-a-time projection; never imports the document library. */
export function FileBrowserPreviewPdf({
  blob,
  fallback,
  identity = "pdf",
  settings = browserSettings(),
}: {
  blob: Blob;
  fallback?: ReactNode;
  identity?: string;
  settings?: BrowserSettingsStore;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1),
    [zoom, setZoom] = useState(0);
  const [density, setDensity] = useState(() => window.devicePixelRatio || 1);
  const [width, setWidth] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const [outline, setOutline] = useState<
    Array<{ title: string; dest: unknown; depth: number }>
  >([]);
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      Array<{ page: number; snippet: string; from: number; to: number }>
    >([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(0),
    [searchError, setSearchError] = useState("");
  const searchInput = useRef<HTMLInputElement>(null),
    pageInput = useRef<HTMLInputElement>(null);
  const [activeHit, setActiveHit] = useState(-1);
  const searchEpoch = useRef(0),
    fingerprint = useRef(""),
    restore = useRef<{ top: number; left: number } | null>(null),
    ready = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const textView = useRef<{
    page: number;
    divs: HTMLElement[];
    items: string[];
  } | null>(null);
  const [textRevision, setTextRevision] = useState(0);
  const stopLoading = useRef(() => {});
  const lastScroll = useRef({ top: 0, left: 0 });
  const [notice, setNotice] = useState("");
  const live = useRef({ page, zoom, settings, identity });
  live.current = { page, zoom, settings, identity };
  const persist = () => {
    if (!fingerprint.current) return;
    const value = live.current;
    try {
      saveReaderPreviewState(value.settings, value.identity, {
        fingerprint: fingerprint.current,
        page: value.page,
        zoom: value.zoom,
        top:
          ready.current && viewport.current
            ? viewport.current.scrollTop
            : (restore.current?.top ?? lastScroll.current.top),
        left:
          ready.current && viewport.current
            ? viewport.current.scrollLeft
            : (restore.current?.left ?? lastScroll.current.left),
        font: 100,
      });
    } catch {
      setNotice("无法保存 PDF 阅读位置，本次阅读仍可继续。");
    }
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (doc) persistRef.current();
  }, [doc, page, zoom]);
  const jump = (value: number) => {
    if (!doc || value < 1 || value > doc.numPages) return;
    if (value === page) {
      viewport.current?.scrollTo(0, 0);
      return;
    }
    persist();
    ready.current = false;
    restore.current = { top: 0, left: 0 };
    setPage(value);
  };
  const find = async () => {
    const needle = query.trim(),
      epoch = ++searchEpoch.current;
    setResults([]);
    setActiveHit(-1);
    setSearched(0);
    setSearchError("");
    if (!doc || !needle) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const found: Array<{
      page: number;
      snippet: string;
      from: number;
      to: number;
    }> = [];
    try {
      for (let index = 1; index <= doc.numPages; index++) {
        if (searchEpoch.current !== epoch) return;
        const item = await doc.getPage(index);
        const text = await item.getTextContent();
        if (searchEpoch.current !== epoch) return;
        const content = text.items
          .map((value) => ("str" in value ? value.str : ""))
          .join(" ");
        for (const match of browserPreviewMatches(content, needle).matches) {
          if (found.length >= 1000) break;
          found.push({
            page: index,
            from: match.from,
            to: match.to,
            snippet: content.slice(Math.max(0, match.from - 30), match.to + 60),
          });
        }
        if (index !== live.current.page) item.cleanup();
        setSearched(index);
        setResults([...found]);
        if (found.length >= 1000) {
          setSearchError("已达到1000条结果上限，请缩小查找范围。");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch {
      if (searchEpoch.current === epoch) setSearchError("查找中断，请重试。");
    } finally {
      if (searchEpoch.current === epoch) setSearching(false);
    }
  };
  const viewport = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      setWidth(element.clientWidth);
      setDensity(window.devicePixelRatio || 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const searches = searchEpoch,
      timer = saveTimer;
    let task: PDFDocumentLoadingTask | undefined;
    stopLoading.current = () => {
      active = false;
      searches.current++;
      void task?.destroy().catch(() => {});
      setDoc(null);
      setBusy(false);
      setError("已中断加载，请重新打开文件重试。");
    };
    // WKWebView's custom tauri: origin can return status 0 for blob URL reads.
    // Feed bytes directly, as the main reader does, instead of issuing a request.
    void (async () => {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!active) return;
      const hash = await crypto.subtle.digest("SHA-256", data);
      if (!active) return;
      const contentFingerprint = Array.from(new Uint8Array(hash), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      task = getDocument({
        data,
        cMapUrl: new URL(
          `${import.meta.env.BASE_URL}pdfjs-cmaps/`,
          location.href,
        ).href,
        cMapPacked: true,
        isEvalSupported: false,
      });
      task.onPassword = () => {
        if (active) {
          setError("此 PDF 需要密码，请使用系统应用打开。");
          setBusy(false);
        }
        void task?.destroy().catch(() => {});
      };
      const value = await task.promise;
      if (active) {
        fingerprint.current = contentFingerprint;
        const saved = readReaderPreviewState(
          live.current.settings,
          live.current.identity,
          fingerprint.current,
        );
        restore.current = saved;
        setZoom(saved.zoom);
        setPage(Math.min(value.numPages, saved.page));
        setDoc(value);
        void value
          .getOutline()
          .then((items) => {
            if (!active) return;
            const flat: Array<{ title: string; dest: unknown; depth: number }> =
              [];
            const visit = (nodes: NonNullable<typeof items>, depth: number) => {
              for (const node of nodes) {
                if (flat.length >= 1000 || depth > 12) break;
                if (node.dest)
                  flat.push({ title: node.title, dest: node.dest, depth });
                visit(node.items, depth + 1);
              }
            };
            visit(items ?? [], 0);
            setOutline(flat);
          })
          .catch(() => {});
      }
    })().catch((cause) => {
      if (active) {
        setError((previous) => previous || String(cause));
        setBusy(false);
      }
    });
    return () => {
      clearTimeout(timer.current);
      persistRef.current();
      searches.current++;
      active = false;
      void task?.destroy().catch(() => {});
    };
  }, [blob]);
  useEffect(() => {
    if (!doc || !width) return;
    const box = surface.current!;
    let live = true;
    let cancel = () => {};
    ready.current = false;
    setBusy(true);
    setError("");
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (!live) return;
      const base = pdfPage.getViewport({ scale: 1 });
      // Bound decoded pixels even for unusually large pages.
      const scale = Math.min(
        zoom || Math.max(100, width - 24) / base.width,
        Math.sqrt(12_000_000 / (base.width * base.height)),
      );
      const view = pdfPage.getViewport({ scale });
      // CSS dimensions describe zoom; bitmap dimensions independently follow
      // screen density so Retina displays do not stretch a 1x image.
      const outputScale = Math.min(
        Math.max(1, density),
        2.5,
        Math.sqrt(12_000_000 / Math.max(1, view.width * view.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(view.width * outputScale));
      canvas.height = Math.max(1, Math.floor(view.height * outputScale));
      canvas.style.width = `${view.width}px`;
      canvas.style.height = `${view.height}px`;
      const text = document.createElement("div");
      text.className = "textLayer";
      box.replaceChildren(canvas, text);
      box.style.width = `${view.width}px`;
      box.style.height = `${view.height}px`;
      box.style.setProperty("--scale-factor", String(scale));
      box.style.setProperty("--total-scale-factor", String(scale));
      const content = await pdfPage.getTextContent();
      if (!live) return;
      const render = pdfPage.render({
        canvasContext: canvas.getContext("2d")!,
        viewport: view,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      });
      const layer = new TextLayer({
        textContentSource: content,
        container: text,
        viewport: view,
      });
      cancel = () => {
        render.cancel();
        layer.cancel();
      };
      await render.promise;
      if (!live) {
        layer.cancel();
        return;
      }
      await layer.render();
      if (live) {
        textView.current = {
          page,
          divs: layer.textDivs,
          items: content.items.map((item) => ("str" in item ? item.str : "")),
        };
        setTextRevision((value) => value + 1);
        setBusy(false);
        const saved = restore.current;
        restore.current = null;
        requestAnimationFrame(() => {
          if (!live || !viewport.current) return;
          if (saved) {
            viewport.current.scrollTop = saved.top;
            viewport.current.scrollLeft = saved.left;
          }
          ready.current = true;
        });
      }
    })().catch((cause) => {
      if (live) {
        setError(String(cause));
        setBusy(false);
      }
    });
    return () => {
      live = false;
      cancel();
      textView.current = null;
      box.replaceChildren();
    };
  }, [doc, page, width, zoom, density]);
  useEffect(() => {
    const rendered = textView.current,
      selected = results[activeHit];
    if (!rendered || rendered.page !== page) return;
    let offset = 0,
      target: HTMLElement | null = null;
    rendered.items.forEach((text, index) => {
      const div = rendered.divs[index];
      if (!div) {
        offset += text.length + 1;
        return;
      }
      div.textContent = text;
      if (selected?.page === page) {
        const from = Math.max(0, selected.from - offset),
          to = Math.min(text.length, selected.to - offset);
        if (from < to) {
          const mark = document.createElement("mark");
          mark.className = "file-browser-pdf-match";
          mark.textContent = text.slice(from, to);
          div.replaceChildren(
            document.createTextNode(text.slice(0, from)),
            mark,
            document.createTextNode(text.slice(to)),
          );
          target ??= mark;
        }
      }
      offset += text.length + 1;
    });
    const reveal = target as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      if (reveal?.isConnected && ready.current)
        reveal.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeHit, results, page, textRevision]);
  const hit = (delta: number) => {
    if (!results.length) return;
    const index =
      activeHit < 0
        ? delta > 0
          ? 0
          : results.length - 1
        : (activeHit + delta + results.length) % results.length;
    setActiveHit(index);
    setTextRevision((value) => value + 1);
    jump(results[index].page);
  };
  return (
    <div
      className="file-browser-pdf-preview"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          searchInput.current?.focus();
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "g"
        ) {
          event.preventDefault();
          event.stopPropagation();
          pageInput.current?.focus();
          pageInput.current?.select();
          return;
        }
        if (event.key === "F3") {
          event.preventDefault();
          hit(event.shiftKey ? -1 : 1);
          return;
        }
        if (event.key === "Escape" && query) {
          event.preventDefault();
          event.stopPropagation();
          searchEpoch.current++;
          setQuery("");
          setResults([]);
          setSearching(false);
          viewport.current?.focus();
          return;
        }
        if ((event.target as HTMLElement).closest("input,select,textarea"))
          return;
        if (event.key === "PageDown") {
          event.preventDefault();
          jump(page + 1);
        }
        if (event.key === "PageUp") {
          event.preventDefault();
          jump(page - 1);
        }
      }}
    >
      <div className="file-browser-preview-zoom">
        <button
          type="button"
          className="btn-icon"
          aria-label="PDF 上一页"
          disabled={!doc || page <= 1}
          onClick={() => jump(page - 1)}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
        <label>
          页{" "}
          <input
            ref={pageInput}
            aria-label="PDF 页码"
            type="number"
            min={1}
            max={doc?.numPages ?? 1}
            value={page}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (
                doc &&
                Number.isInteger(value) &&
                value >= 1 &&
                value <= doc.numPages
              )
                jump(value);
            }}
          />
        </label>
        <span> / {doc?.numPages ?? "…"}</span>
        <button
          type="button"
          className="btn-icon"
          aria-label="PDF 下一页"
          disabled={!doc || page >= doc.numPages}
          onClick={() => jump(page + 1)}
        >
          <ToolbarIcon name="chevronRight" />
        </button>
        <select
          aria-label="PDF 缩放"
          value={zoom}
          onChange={(event) => {
            persist();
            restore.current = {
              top: viewport.current?.scrollTop ?? 0,
              left: viewport.current?.scrollLeft ?? 0,
            };
            setZoom(Number(event.target.value));
          }}
        >
          <option value={0}>适应宽度</option>
          <option value={1}>100%</option>
          <option value={0.75}>75%</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
          <option value={2}>200%</option>
        </select>
      </div>
      {outline.length > 0 && (
        <select
          aria-label="PDF 目录"
          defaultValue=""
          onChange={async (event) => {
            const item = outline[Number(event.target.value)];
            if (!item || !doc) return;
            try {
              const dest =
                typeof item.dest === "string"
                  ? await doc.getDestination(item.dest)
                  : item.dest;
              if (Array.isArray(dest))
                jump(
                  (typeof dest[0] === "number"
                    ? dest[0]
                    : await doc.getPageIndex(dest[0])) + 1,
                );
            } catch {
              setNotice("此目录位置无法跳转。");
            }
            event.target.value = "";
          }}
        >
          <option value="">目录</option>
          {outline.map((item, index) => (
            <option value={index} key={index}>
              {"　".repeat(item.depth)}
              {item.title}
            </option>
          ))}
        </select>
      )}
      <form
        className="file-browser-reader-search"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <input
          ref={searchInput}
          aria-label="PDF 查找文本"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            searchEpoch.current++;
            setSearching(false);
            setResults([]);
          }}
          placeholder="查找文本"
        />
        <button type="submit" disabled={!doc || !query.trim()}>
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
        {query.trim() && (
          <span role="status">
            {searching
              ? `已查找 ${searched}/${doc?.numPages} 页`
              : `${results.length} 处`}
          </span>
        )}
      </form>
      {results.length > 0 && (
        <div>
          <button
            type="button"
            aria-label="PDF 上一处匹配"
            onClick={() => hit(-1)}
          >
            上一处
          </button>
          <button
            type="button"
            aria-label="PDF 下一处匹配"
            onClick={() => hit(1)}
          >
            下一处
          </button>
        </div>
      )}
      {results.length > 0 && (
        <div className="file-browser-reader-results" aria-label="PDF 查找结果">
          {results.map((item, index) => (
            <button
              type="button"
              key={index}
              onClick={() => {
                setActiveHit(index);
                setTextRevision((value) => value + 1);
                jump(item.page);
              }}
            >
              第{item.page}页 · {item.snippet}
            </button>
          ))}
        </div>
      )}
      {searchError && <p role="status">{searchError}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <span role="status">
          正在渲染 PDF…{" "}
          <button type="button" onClick={() => stopLoading.current()}>
            中断加载
          </button>
        </span>
      )}
      {error && (
        <>
          <p role="status">无法预览此 PDF：{error}</p>
          {fallback}
        </>
      )}
      <div
        ref={viewport}
        className="file-browser-pdf-scroll"
        tabIndex={0}
        onScroll={() => {
          if (ready.current && viewport.current)
            lastScroll.current = {
              top: viewport.current.scrollTop,
              left: viewport.current.scrollLeft,
            };
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => persistRef.current(), 250);
        }}
        aria-label="PDF 内容"
      >
        <div ref={surface} className="file-browser-pdf-page" />
      </div>
    </div>
  );
}
