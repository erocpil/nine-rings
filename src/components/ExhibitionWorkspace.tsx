import { useEffect, useState, lazy, Suspense, type ReactNode } from "react";
import { api } from "../lib/api";
import { INTERFACE_STYLES } from "../lib/interface-style";
import type { AppConfig } from "../lib/storage/types";
import { readDocumentFavorites } from "../lib/document-favorites";
import { readRecentNoteIds } from "../lib/quick-switcher";
import type { Note } from "../types/models";
import "./ExhibitionWorkspace.css";

const TitleBar = lazy(() => import("./TitleBar"));

type Summary = Awaited<ReturnType<typeof api.docs.searchSummaries>>[number];
interface Props {
  children: ReactNode;
  enabled: boolean;
  desktop: boolean;
  focus: boolean;
  blocked: boolean;
  config: AppConfig | null;
  path: string;
  noteId?: string;
  refreshKey: number;
  onAppearance: (patch: Partial<AppConfig>) => Promise<void>;
  onOpen: (note: Note) => Promise<void>;
  onHome: () => Promise<void>;
  canReturn: boolean;
  onCreate: () => void;
  onSearch: () => void;
  onSettings: () => void;
}

export function ExhibitionWorkspace(props: Props) {
  const { enabled, focus, blocked, config, noteId, path, refreshKey } = props;
  const active = enabled && !focus;
  const density =
    config?.exhibition_density ??
    (config?.interface_style === "calm-compact" ||
    config?.interface_style === "minimal"
      ? "compact"
      : "comfortable");
  const [expanded, setExpanded] = useState(false);
  const showOverview = active && (!noteId || expanded);
  const [documents, setDocuments] = useState<Summary[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!showOverview) return;
    let disposed = false;
    setLoading(true);
    setFavorites(readDocumentFavorites());
    setRecent(readRecentNoteIds());
    void api.docs
      .searchSummaries({})
      .then(
        (notes) => {
          if (!disposed) {
            setDocuments(notes);
            setError("");
          }
        },
        (reason) => {
          if (!disposed) setError(`加载概览失败：${String(reason)}`);
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [showOverview, refreshKey, retry]);
  const run = async (action: () => Promise<void>) => {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) =>
    void run(async () => {
      const note = await api.notes.get(id);
      if (!note) throw new Error("文档已不存在，请刷新概览。");
      await props.onOpen(note);
      setExpanded(false);
    });
  const rows = (notes: Summary[], empty: string) =>
    notes.length ? (
      <ul>
        {notes.slice(0, 3).map((note) => (
          <li key={note.id}>
            <button
              type="button"
              title={note.title || "未命名文档"}
              disabled={busy || blocked}
              onClick={() => open(note.id)}
            >
              {note.title || "未命名文档"}
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="exhibition-muted">{loading ? "正在加载…" : empty}</p>
    );
  const identity = (
    <button
      type="button"
      className="exhibition-identity"
      onClick={() => void run(props.onHome)}
      disabled={busy || blocked}
      aria-label={props.canReturn ? "返回上一页面" : "返回工作区首页"}
      title={props.canReturn ? "返回上一页面" : "返回工作区首页"}
    >
      <span>NINE RINGS / WORKSPACE</span>
      <strong title={path}>{path || "我的工作区"}</strong>
    </button>
  );
  const appearance = (
    <div className="exhibition-appearance">
      <label>
        <select
          aria-label="工作区风格"
          disabled={busy || blocked}
          value={config?.interface_style === "calm-compact" ? "calm" : config?.interface_style}
          onChange={(event) => {
            const style = event.target.value as AppConfig["interface_style"];
            void run(() => props.onAppearance({ interface_style: style }));
          }}
        >
          {INTERFACE_STYLES.filter((style) => style.value !== "classic").map(
            (style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <select
          aria-label="工作区配色"
          disabled={busy || blocked}
          value={config?.interface_color_mode ?? "system"}
          onChange={(event) => {
            const mode = event.target
              .value as AppConfig["interface_color_mode"];
            void run(() => props.onAppearance({ interface_color_mode: mode }));
          }}
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="system">跟随系统</option>
        </select>
      </label>
      {props.desktop && (
        <>
          <label>
            <select
              aria-label="文本宽度"
              title="文本宽度"
              disabled={busy || blocked}
              value={config?.exhibition_text_width ?? "standard"}
              onChange={(event) => {
                const value = event.target
                  .value as AppConfig["exhibition_text_width"];
                void run(() =>
                  props.onAppearance({ exhibition_text_width: value }),
                );
              }}
            >
              <option value="narrow">窄幅</option>
              <option value="standard">标准宽度</option>
              <option value="wide">宽幅</option>
            </select>
          </label>
          <label>
            <select
              aria-label="紧凑程度"
              title="紧凑程度"
              disabled={busy || blocked}
              value={density}
              onChange={(event) => {
                const value = event.target
                  .value as AppConfig["exhibition_density"];
                void run(() =>
                  props.onAppearance({ exhibition_density: value }),
                );
              }}
            >
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
  return (
    <div
      className={`exhibition-shell${active ? " is-exhibition" : ""}`}
      data-text-width={
        enabled && props.desktop
          ? (config?.exhibition_text_width ?? "standard")
          : undefined
      }
      data-density={enabled && props.desktop ? density : undefined}
    >
      {active && (
        <header className="exhibition-masthead">
          {props.desktop ? (
            <Suspense fallback={null}>
              <TitleBar exhibition workspace={identity}>
                {appearance}
              </TitleBar>
            </Suspense>
          ) : (
            <>
              {identity}
              {appearance}
            </>
          )}
        </header>
      )}
      {props.children}
      {active && (
        <section
          className="exhibition-overview"
          aria-label="工作区概览"
          {...(blocked ? { inert: "" } : {})}
        >
          <div className="exhibition-overview-heading">
            <div>
              <span className="exhibition-eyebrow">THE WORKSPACE</span>
              <h2>{showOverview ? "给思考留一点空间。" : "工作区概览"}</h2>
            </div>
            {noteId && (
              <button
                type="button"
                aria-expanded={showOverview}
                aria-controls="exhibition-columns"
                onClick={() => setExpanded((value) => !value)}
              >
                {showOverview ? "收起概览" : "展开概览"}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="exhibition-error">
              {error}{" "}
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                刷新
              </button>
              <button type="button" onClick={() => setError("")}>
                关闭提示
              </button>
            </p>
          )}
          {showOverview && (
            <>
              <p className="exhibition-description">
                从上次停下的地方继续，或打开一篇值得再次阅读的文档。
              </p>
              <div
                className="exhibition-columns"
                id="exhibition-columns"
                aria-busy={loading}
              >
                <section>
                  <h3>
                    <span>01 /</span> 继续阅读
                  </h3>
                  {rows(
                    recent.flatMap((id) =>
                      documents.filter((note) => note.id === id),
                    ),
                    "打开文档后，会在这里留下阅读入口。",
                  )}
                </section>
                <section>
                  <h3>
                    <span>02 /</span> 常用文档
                  </h3>
                  {rows(
                    documents.filter((note) => favorites.includes(note.id)),
                    "在文档列表中收藏常用文档，即可在这里快速打开。",
                  )}
                </section>
                <section>
                  <h3>
                    <span>03 /</span> 最近修改
                  </h3>
                  {rows(
                    [...documents].sort((a, b) =>
                      b.updated_at.localeCompare(a.updated_at),
                    ),
                    "新建文档，开始记录。",
                  )}
                </section>
                <section>
                  <h3>
                    <span>04 /</span> 快捷操作
                  </h3>
                  <ul>
                    <li>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={props.onCreate}
                      >
                        新建文档
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={props.onSearch}
                      >
                        查找文档
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={props.onSettings}
                      >
                        外观与工作区设置
                      </button>
                    </li>
                  </ul>
                </section>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function ExhibitionWelcome({
  onCreate,
  onSearch,
  disabled,
}: {
  onCreate: () => void;
  onSearch: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="exhibition-welcome">
      <span className="exhibition-eyebrow">WORKSPACE NOTES</span>
      <h1>让内容成为界面的中心。</h1>
      <p>
        一个安静的阅读与写作空间。
        <br />
        从目录选择文档，或在下方继续上次的阅读。
      </p>
      <div>
        <button type="button" disabled={disabled} onClick={onCreate}>
          新建文档
        </button>
        <button type="button" disabled={disabled} onClick={onSearch}>
          查找文档
        </button>
      </div>
    </section>
  );
}
