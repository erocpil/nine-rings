import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  deleteLocalPdf,
  importLocalPdf,
  listLocalPdfs,
  type LocalPdfEntry,
} from "../lib/pdf-library";
import {
  deleteLocalEpub,
  getLocalEpubCover,
  importLocalEpub,
  listLocalEpubs,
  type LocalEpubEntry,
} from "../lib/epub-library";
import { ReaderDataBackupPanel } from "./ReaderDataBackupPanel";
import { ToolbarIcon } from "./ToolbarIcon";
import "./ReadingLibrary.css";

export interface ReadingLibrarySession {
  format: "all" | "pdf" | "epub";
  query: string;
  scrollTop: number;
  openedId?: string;
  view?: "shelf" | "list";
}
interface Props {
  session: ReadingLibrarySession;
  onClose: () => void;
  onSettings: () => void;
  onOpenPdf: (id: string) => void;
  onOpenEpub: (id: string) => void;
}

export default function ReadingLibrary({
  session,
  onClose,
  onSettings,
  onOpenPdf,
  onOpenEpub,
}: Props) {
  const [query, setQuery] = useState(session.query);
  const [message, showMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const restoredRef = useRef(false);
  const coverRequestRef = useRef(0);
  const coverUrlsRef = useRef<Record<string, string>>({});
  useEffect(
    () => () => {
      coverRequestRef.current++;
      Object.values(coverUrlsRef.current).forEach(URL.revokeObjectURL);
      coverUrlsRef.current = {};
    },
    [],
  );
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [pdfEntries, setPdfEntries] = useState<LocalPdfEntry[]>([]);
  const [pdfLibraryLoading, setPdfLibraryLoading] = useState(true);
  const [pdfImporting, setPdfImporting] = useState(false);
  const epubInputRef = useRef<HTMLInputElement>(null);
  const [epubEntries, setEpubEntries] = useState<LocalEpubEntry[]>([]);
  const [epubLibraryLoading, setEpubLibraryLoading] = useState(true);
  const [epubImporting, setEpubImporting] = useState(false);
  const [epubCoverUrls, setEpubCoverUrls] = useState<Record<string, string>>(
    {},
  );
  const [libraryFormat, setLibraryFormat] = useState<"all" | "pdf" | "epub">(
    session.format,
  );
  const [readerBackupTarget, setReaderBackupTarget] = useState<{
    format: "pdf" | "epub";
    id: string;
    title: string;
  } | null>(null);
  const [readerBackupBusy, setReaderBackupBusy] = useState(false);
  const [libraryView, setLibraryView] = useState<"shelf" | "list">(() => {
    if (session.view) return session.view;
    try {
      return localStorage.getItem("nine-rings-reader-library-view") === "list"
        ? "list"
        : "shelf";
    } catch {
      return "shelf";
    }
  });

  useEffect(() => {
    session.view = libraryView;
    try {
      localStorage.setItem("nine-rings-reader-library-view", libraryView);
    } catch {
      /* ignore unavailable storage */
    }
  }, [libraryView, session]);

  useEffect(() => {
    session.query = query;
    session.format = libraryFormat;
  }, [session, query, libraryFormat]);
  const refreshPdfLibrary = useCallback(async () => {
    setPdfLibraryLoading(true);
    try {
      setPdfEntries(await listLocalPdfs());
    } catch (reason) {
      showMessage(
        `PDF 资料库读取失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setPdfLibraryLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    void refreshPdfLibrary();
  }, [refreshPdfLibrary]);

  const handlePdfImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfImporting(true);
    try {
      const imported = await importLocalPdf(file);
      await refreshPdfLibrary();
      showMessage(`已导入 PDF：${imported.name}`);
      session.openedId = imported.id;
      onOpenPdf(imported.id);
    } catch (reason) {
      showMessage(
        `PDF 导入失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setPdfImporting(false);
      event.target.value = "";
    }
  };

  const handlePdfDelete = async (entry: LocalPdfEntry) => {
    if (!window.confirm(`删除本地 PDF「${entry.name}」？此操作不会影响笔记。`))
      return;
    setDeleting(true);
    try {
      await deleteLocalPdf(entry.id);
      await refreshPdfLibrary();
      showMessage(`已删除 PDF：${entry.name}`);
    } catch (reason) {
      showMessage(
        `PDF 删除失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setDeleting(false);
    }
  };

  const refreshEpubLibrary = useCallback(async () => {
    const request = ++coverRequestRef.current;
    setEpubLibraryLoading(true);
    try {
      const entries = await listLocalEpubs();
      setEpubEntries(entries);
      const covers = await Promise.all(
        entries
          .filter((entry) => entry.hasCover)
          .map(async (entry) => {
            const blob = await getLocalEpubCover(entry.id);
            return [entry.id, blob] as const;
          }),
      );
      if (request !== coverRequestRef.current) return;
      const urls = Object.fromEntries(
        covers
          .filter(([, blob]) => blob)
          .map(([id, blob]) => [id, URL.createObjectURL(blob!)]),
      );
      Object.values(coverUrlsRef.current).forEach(URL.revokeObjectURL);
      coverUrlsRef.current = urls;
      setEpubCoverUrls(urls);
    } catch (reason) {
      showMessage(
        `EPUB 资料库读取失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      if (request === coverRequestRef.current) setEpubLibraryLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    void refreshEpubLibrary();
  }, [refreshEpubLibrary]);

  const handleEpubImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEpubImporting(true);
    try {
      const imported = await importLocalEpub(file);
      await refreshEpubLibrary();
      showMessage(`已导入 EPUB：${imported.title}`);
      session.openedId = imported.id;
      onOpenEpub(imported.id);
    } catch (reason) {
      showMessage(
        `EPUB 导入失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setEpubImporting(false);
      event.target.value = "";
    }
  };

  const handleEpubDelete = async (entry: LocalEpubEntry) => {
    if (
      !window.confirm(`删除本地 EPUB「${entry.title}」？此操作不会影响笔记。`)
    )
      return;
    setDeleting(true);
    try {
      await deleteLocalEpub(entry.id);
      await refreshEpubLibrary();
      showMessage(`已删除 EPUB：${entry.title}`);
    } catch (reason) {
      showMessage(
        `EPUB 删除失败：${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setDeleting(false);
    }
  };

  const allLibraryItems: Array<
    | { format: "pdf"; entry: LocalPdfEntry }
    | { format: "epub"; entry: LocalEpubEntry }
  > = [
    ...pdfEntries.map((entry) => ({ format: "pdf" as const, entry })),
    ...epubEntries.map((entry) => ({ format: "epub" as const, entry })),
  ].sort((left, right) =>
    right.entry.lastOpenedAt.localeCompare(left.entry.lastOpenedAt),
  );

  const busy = pdfImporting || epubImporting || readerBackupBusy || deleting;
  const libraryItems = allLibraryItems.filter((item) => {
    if (libraryFormat !== "all" && libraryFormat !== item.format) return false;
    const text =
      item.format === "pdf"
        ? item.entry.name
        : item.entry.title +
          " " +
          item.entry.name +
          " " +
          (item.entry.author ?? "");
    return text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  const recent = allLibraryItems[0];
  useLayoutEffect(() => {
    if (
      pdfLibraryLoading ||
      epubLibraryLoading ||
      restoredRef.current ||
      !scrollRef.current
    )
      return;
    restoredRef.current = true;
    scrollRef.current.scrollTop = session.scrollTop;
    const item = Array.from(
      scrollRef.current.querySelectorAll<HTMLElement>("[data-document-id]"),
    ).find((el) => el.dataset.documentId === session.openedId);
    if (document.activeElement === headingRef.current || document.activeElement === document.body) {
      item?.querySelector<HTMLButtonElement>(".reader-library-open")?.focus({ preventScroll: true });
    }
  }, [pdfLibraryLoading, epubLibraryLoading, session]);
  return (
    <section
      className="reading-library-page"
      aria-label="阅读资料库"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          searchRef.current?.focus();
          return;
        }
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        if (readerBackupTarget) setReaderBackupTarget(null);
        else onClose();
      }}
    >
      <header className="reading-library-heading">
        <button
          type="button"
          className="settings-btn"
          onClick={onClose}
          disabled={busy}
          aria-label="返回笔记"
        >
          <ToolbarIcon name="chevronLeft" />
          返回笔记
        </button>
        <h1 ref={headingRef} tabIndex={-1}>
          阅读资料库
        </h1>
        <button
          type="button"
          className="settings-btn"
          title="设置"
          aria-label="设置"
          onClick={onSettings}
          disabled={busy}
        >
          <ToolbarIcon name="sliders" />
        </button>
      </header>
      <div
        className="reading-library-content"
        ref={scrollRef}
        onScroll={(event) => {
          if (restoredRef.current)
            session.scrollTop = event.currentTarget.scrollTop;
        }}
      >
        <p className="settings-hint">
          原文件保存在当前设备；每本书可单独备份阅读数据，尚未纳入全量 JSON 或
          GitHub 备份。
        </p>
        {message && (
          <div className="reading-library-message" role="status">
            {message}
          </div>
        )}
        {!pdfLibraryLoading && !epubLibraryLoading && recent && (
          <button
            type="button"
            className="reading-library-continue"
            disabled={busy}
            onClick={() => {
              session.openedId = recent.entry.id;
              if (recent.format === "pdf") onOpenPdf(recent.entry.id);
              else onOpenEpub(recent.entry.id);
            }}
            aria-label="继续阅读"
          >
            <span>继续阅读 · {recent.format.toUpperCase()}</span>
            <strong>
              {recent.format === "pdf" ? recent.entry.name : recent.entry.title}
            </strong>
            <small>
              {recent.format === "pdf"
                ? `第 ${recent.entry.page} 页`
                : `第 ${recent.entry.chapter + 1} 章`}
            </small>
          </button>
        )}
        <label className="reading-library-search">
          查找书籍
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              session.scrollTop = 0;
            }}
            placeholder="按书名、文件名或作者查找"
          />
        </label>
        {readerBackupTarget && (
          <ReaderDataBackupPanel
            key={`${readerBackupTarget.format}-${readerBackupTarget.id}`}
            format={readerBackupTarget.format}
            documentId={readerBackupTarget.id}
            title={readerBackupTarget.title}
            onClose={() => setReaderBackupTarget(null)}
            onBusyChange={setReaderBackupBusy}
            onRestored={() => {
              void refreshPdfLibrary();
              void refreshEpubLibrary();
            }}
          />
        )}
        <div className="reader-library-toolbar">
          <div className="settings-button-row reader-library-imports">
            <button
              className="settings-btn-primary"
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              disabled={busy}
            >
              {pdfImporting ? "正在导入 PDF…" : "导入 PDF"}
            </button>
            <button
              className="settings-btn-primary"
              type="button"
              onClick={() => epubInputRef.current?.click()}
              disabled={busy}
            >
              {epubImporting ? "正在导入 EPUB…" : "导入 EPUB"}
            </button>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              onChange={handlePdfImport}
            />
            <input
              ref={epubInputRef}
              type="file"
              accept="application/epub+zip,.epub"
              style={{ display: "none" }}
              onChange={handleEpubImport}
            />
          </div>
          <div className="reader-library-controls">
            <button
              type="button"
              className="settings-btn"
              disabled={busy || pdfLibraryLoading || epubLibraryLoading}
              onClick={() => {
                showMessage(null);
                void refreshPdfLibrary();
                void refreshEpubLibrary();
              }}
              aria-label="刷新阅读资料库"
            >
              刷新
            </button>
            <div
              className="reader-library-segment"
              aria-label="阅读资料库格式筛选"
            >
              {(["all", "pdf", "epub"] as const).map((format) => (
                <button
                  type="button"
                  key={format}
                  className={libraryFormat === format ? "active" : ""}
                  aria-pressed={libraryFormat === format}
                  onClick={() => setLibraryFormat(format)}
                >
                  {format === "all" ? "全部" : format.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="reader-library-segment" aria-label="阅读资料库视图">
              <button
                type="button"
                className={libraryView === "shelf" ? "active" : ""}
                aria-pressed={libraryView === "shelf"}
                onClick={() => setLibraryView("shelf")}
                aria-label="书架视图"
              >
                ▦
              </button>
              <button
                type="button"
                className={libraryView === "list" ? "active" : ""}
                aria-pressed={libraryView === "list"}
                onClick={() => setLibraryView("list")}
                aria-label="列表视图"
              >
                ☷
              </button>
            </div>
          </div>
        </div>
        {pdfLibraryLoading || epubLibraryLoading ? (
          <div className="pdf-library-empty">正在读取阅读资料库…</div>
        ) : libraryItems.length === 0 ? (
          <div className="pdf-library-empty">
            {query.trim()
              ? "没有找到匹配的书籍"
              : libraryFormat === "all"
                ? "尚未导入 PDF 或 EPUB"
                : `尚未导入 ${libraryFormat.toUpperCase()}`}
          </div>
        ) : (
          <div className={`reader-library-items reader-library-${libraryView}`}>
            {libraryItems.map((item) => {
              const isPdf = item.format === "pdf";
              const title = isPdf ? item.entry.name : item.entry.title;
              const progressText = isPdf
                ? item.entry.pageCount
                  ? `第 ${item.entry.page}/${item.entry.pageCount} 页`
                  : "尚未记录页数"
                : item.entry.chapterCount
                  ? `第 ${item.entry.chapter + 1}/${item.entry.chapterCount} 章`
                  : "尚未记录章节";
              return (
                <article
                  className="reader-library-item"
                  data-format={item.format}
                  data-document-id={item.entry.id}
                  key={`${item.format}-${item.entry.id}`}
                >
                  <button
                    type="button"
                    className="reader-library-open"
                    disabled={busy}
                    onClick={() => {
                      session.openedId = item.entry.id;
                      if (isPdf) onOpenPdf(item.entry.id);
                      else onOpenEpub(item.entry.id);
                    }}
                    title={`打开 ${title}`}
                    aria-label={`打开 ${title}`}
                  >
                    <span className="reader-library-cover">
                      {!isPdf && epubCoverUrls[item.entry.id] ? (
                        <img src={epubCoverUrls[item.entry.id]} alt="" />
                      ) : (
                        <span aria-hidden="true">{isPdf ? "PDF" : "📖"}</span>
                      )}
                      <em>{item.format.toUpperCase()}</em>
                    </span>
                    <span className="reader-library-meta">
                      <strong>{title}</strong>
                      {!isPdf && item.entry.author && (
                        <small>{item.entry.author}</small>
                      )}
                      <small>
                        {progressText} · {formatStorageBytes(item.entry.size)}
                      </small>
                      <small>
                        最近阅读 {formatLibraryDate(item.entry.lastOpenedAt)}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="reader-library-backup"
                    disabled={busy}
                    onClick={() =>
                      setReaderBackupTarget({
                        format: item.format,
                        id: item.entry.id,
                        title,
                      })
                    }
                    aria-label={`阅读数据备份 ${title}`}
                  >
                    阅读备份
                  </button>
                  <button
                    type="button"
                    className="reader-library-delete"
                    disabled={busy}
                    onClick={() =>
                      isPdf
                        ? void handlePdfDelete(item.entry)
                        : void handleEpubDelete(item.entry)
                    }
                    aria-label={`删除 ${title}`}
                    title={`删除本地 ${item.format.toUpperCase()}`}
                  >
                    ×
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "不可用";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatLibraryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
