import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  vocabularyDocuments,
  readVocabularyPreference,
  subscribeVocabulary,
  vocabularySnapshot,
  type VocabularyDocumentSummary,
} from "../lib/plugin-system/builtin-vocabulary";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import {
  readVocabularySort,
  saveVocabularySort,
  sortVocabulary,
  type VocabularySort,
} from "../lib/vocabulary-reading-state";
import { WorkspacePanelHeading } from "./WorkspacePanelHeading";
import { ToolbarIcon } from "./ToolbarIcon";
import "./vocabulary.css";
export function VocabularyPanel({
  active,
  refreshKey,
  onOpen,
  onBack,
  selectedDocumentId,
}: {
  selectedDocumentId?: string;
  active: boolean;
  refreshKey: number;
  onOpen: (id: string) => Promise<void>;
  onBack?: () => void;
}) {
  useSyncExternalStore(subscribeVocabulary, vocabularySnapshot);
  const preference = readVocabularyPreference();
  const view = useSyncExternalStore(mainViews.subscribe, mainViews.getSnapshot);
  const [items, setItems] = useState<VocabularyDocumentSummary[]>([]);
  const [order, setOrder] = useState(readVocabularySort);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const busy = openingId !== null;
  const sorted = useMemo(() => sortVocabulary(items, order), [items, order]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    void vocabularyDocuments
      .list()
      .then(
        (notes) => {
          if (!disposed) {
            setItems(notes);
            setError("");
          }
        },
        (reason) => {
          if (!disposed) setError(String(reason));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [active, refreshKey, preference.path, retry]);
  const current =
    !view.suspended && view.current?.renderer === "vocabulary"
      ? view.current.data.documentId
      : selectedDocumentId;
  // A search result may open a normal document rather than the learning view.
  // Reveal the same document identity without changing the central view.
  useEffect(() => {
    if (active && current) setQuery("");
  }, [active, current]);
  const revealCurrent = useCallback(() => {
    const root = list.current;
    const item =
      root &&
      Array.from(
        root.querySelectorAll<HTMLButtonElement>("button[data-vocabulary-id]"),
      ).find((element) => element.dataset.vocabularyId === current);
    if (!root || !item) return;
    const row = item.getBoundingClientRect(),
      bounds = root.getBoundingClientRect();
    if (row.top < bounds.top || row.bottom > bounds.bottom)
      root.scrollTop +=
        row.top - bounds.top - (root.clientHeight - row.height) / 2;
  }, [current]);
  useLayoutEffect(() => {
    if (active) revealCurrent();
  }, [
    active,
    current,
    items,
    query,
    order,
    preference.listFont,
    preference.listFontSize,
    preference.listLineHeight,
    preference.listRowHeight,
    revealCurrent,
  ]);
  return (
    <section
      className="vocabulary-panel"
      aria-label="词汇学习分栏"
      style={
        {
          "--vocabulary-list-font": {
            interface: "var(--font)",
            editor: "var(--editor-font-family, var(--font))",
            sans: "system-ui, sans-serif",
            serif: "Georgia, Songti SC, serif",
            mono: "var(--font-mono, monospace)",
          }[preference.listFont],
          "--vocabulary-list-size": `${preference.listFontSize}px`,
          "--vocabulary-list-line-height": preference.listLineHeight,
          "--vocabulary-list-row-height": `${preference.listRowHeight}px`,
        } as CSSProperties
      }
    >
      <WorkspacePanelHeading
        title={
          <select
            aria-label="词汇排序"
            value={order}
            onChange={(event) => {
              const next = event.target.value as VocabularySort;
              setOrder(next);
              saveVocabularySort(next);
            }}
          >
            <option value="alphabet">字母顺序 A–Z</option>
            <option value="added">添加时间 · 最新在前</option>
          </select>
        }
      >
        {onBack && (
          <button
            type="button"
            className="btn-icon"
            aria-label="返回文档树"
            title="返回文档树"
            onClick={onBack}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          aria-label="定位当前词汇"
          title="定位当前词汇"
          disabled={!items.some((item) => item.id === current)}
          onClick={() => {
            setQuery("");
            revealCurrent();
          }}
        >
          <ToolbarIcon name="search" />
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label="刷新词汇列表"
          title="刷新词汇列表"
          onClick={() => setRetry((value) => value + 1)}
        >
          <ToolbarIcon name="refresh" />
        </button>
      </WorkspacePanelHeading>
      <p className="vocabulary-path" title={preference.path}>
        {preference.path}
      </p>
      <input
        type="search"
        aria-label="查找词汇"
        placeholder="查找词汇…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">正在加载词汇列表…</p>}
      <ul ref={list}>
        {sorted
          .filter((note) =>
            (note.title ?? "无标题")
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((note) => (
            <li key={note.id}>
              <button
                type="button"
                data-vocabulary-id={note.id}
                aria-current={note.id === current ? "true" : undefined}
                disabled={busy}
                aria-busy={openingId === note.id || undefined}
                title={`${note.title || "无标题"}\n${note.storagePath}`}
                data-tooltip-align="start"
                onClick={() => {
                  if (note.id === current && !view.suspended) return;
                  setOpeningId(note.id);
                  setError("");
                  void onOpen(note.id)
                    .catch((reason) => setError(String(reason)))
                    .finally(() => setOpeningId(null));
                }}
              >
                <ToolbarIcon name="book" />
                <span>{note.title || "无标题"}</span>
              </button>
            </li>
          ))}
      </ul>
      {!loading &&
        query.trim() &&
        !items.some((note) =>
          (note.title ?? "无标题")
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && (
          <p className="vocabulary-empty" role="status">
            没有匹配的词汇
          </p>
        )}
      {items.length === 5000 && (
        <p className="vocabulary-empty">
          当前最多展示 5000 份文档，请缩小配置路径。
        </p>
      )}
      {!loading && !items.length && !error && (
        <p className="vocabulary-empty">
          此路径暂无文档。请手动生成 .md 后，通过“备份与导入”导入到该路径。
        </p>
      )}
    </section>
  );
}
