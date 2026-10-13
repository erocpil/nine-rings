import { useEffect, useState, useSyncExternalStore } from "react";
import {
  vocabularyDocuments,
  readVocabularyPreference,
  subscribeVocabulary,
  vocabularySnapshot,
} from "../lib/plugin-system/builtin-vocabulary";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import type { WorkspaceDocumentSummary } from "../lib/workspace-summary";
import { WorkspacePanelHeading } from "./WorkspacePanelHeading";
import { ToolbarIcon } from "./ToolbarIcon";
import "./vocabulary.css";
export function VocabularyPanel({
  active,
  refreshKey,
  onOpen,
  onBack,
}: {
  active: boolean;
  refreshKey: number;
  onOpen: (id: string) => Promise<void>;
  onBack?: () => void;
}) {
  const pref = useSyncExternalStore(subscribeVocabulary, vocabularySnapshot);
  const view = useSyncExternalStore(mainViews.subscribe, mainViews.getSnapshot);
  const [items, setItems] = useState<WorkspaceDocumentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
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
  }, [active, refreshKey, pref, retry]);
  const current =
    view.current?.renderer === "vocabulary"
      ? view.current.data.documentId
      : null;
  return (
    <section className="vocabulary-panel" aria-label="词汇学习分栏">
      <WorkspacePanelHeading title="词汇学习">
        {onBack && (
          <button
            type="button"
            className="btn-icon"
            aria-label="返回文档树"
            onClick={onBack}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          aria-label="刷新词汇列表"
          onClick={() => setRetry((value) => value + 1)}
        >
          <ToolbarIcon name="refresh" />
        </button>
      </WorkspacePanelHeading>
      <p className="vocabulary-path" title={readVocabularyPreference().path}>
        {readVocabularyPreference().path}
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
      <ul>
        {items
          .filter((note) =>
            (note.title ?? "无标题")
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          )
          .map((note) => (
            <li key={note.id}>
              <button
                type="button"
                aria-current={note.id === current ? "true" : undefined}
                disabled={busy}
                title={`${note.title}\n${note.storagePath}`}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void onOpen(note.id)
                    .catch((reason) => setError(String(reason)))
                    .finally(() => setBusy(false));
                }}
              >
                <ToolbarIcon name="book" />
                <span>{note.title || "无标题"}</span>
              </button>
            </li>
          ))}
      </ul>
      {items.length === 5000 && <p className="vocabulary-empty">当前最多展示 5000 份文档，请缩小配置路径。</p>}
      {!loading && !items.length && !error && (
        <p className="vocabulary-empty">
          此路径暂无文档。请手动生成 .md 后，通过“备份与导入”导入到该路径。
        </p>
      )}
    </section>
  );
}
