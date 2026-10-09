import { useWorkspaceLayout } from "../hooks/useWorkspaceLayout";
import { useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from "react";
import { DocumentFilterSelect } from "./DocumentFilterSelect";
import "./DocumentBrowser.css";
import { api } from "../lib/api";
import { INTERFACE_STYLES } from "../lib/interface-style";
import type { AppConfig } from "../lib/storage/types";
import { DOCUMENT_FAVORITES_CHANGED_EVENT, readDocumentFavorites } from "../lib/document-favorites";
import { workspaceDocuments, workspaceCounts, workspaceSummaryDocuments, type WorkspaceDocumentSummary, type WorkspaceSummaryKind } from "../lib/workspace-summary";
import { WorkspaceSummaryPreview } from "./WorkspaceSummaryPreview";
import { useLocalDay } from "../hooks/useLocalDay";
import { readRecentNoteIds } from "../lib/quick-switcher";
import type { Note } from "../types/models";
import "./ExhibitionWorkspace.css";

const TitleBar = lazy(() => import("./TitleBar"));

type Summary = WorkspaceDocumentSummary;
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
  activeSummary?: WorkspaceSummaryKind | null;
  onSummary: (kind: WorkspaceSummaryKind) => void;
  latestNote: Pick<Note, "id" | "updated_at"> | null;
}

export function ExhibitionWorkspace(props: Props) {
  const { enabled, focus, blocked, config, noteId, path, refreshKey } = props;
  const active = enabled && !focus;
  const density = config?.exhibition_density ?? "comfortable";
  const [expanded, setExpanded] = useState(false);
  const [openAppearance, setOpenAppearance] = useState<string | null>(null);
  const showOverview = active && (!noteId || expanded);
  const [documents, setDocuments] = useState<Summary[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const day = useLocalDay();
  const counts = useMemo(() => workspaceCounts(documents, favorites, day), [documents, favorites, day]);
  const summaryLayout = useWorkspaceLayout();
  const [summaryPreview, setSummaryPreview] = useState<{ kind: WorkspaceSummaryKind; trigger: HTMLButtonElement; keyboard: boolean } | null>(null);
  const summaryCloseTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepSummary = () => clearTimeout(summaryCloseTimer.current);
  const closeSummary = (restoreFocus = false) => {
    keepSummary();
    if (restoreFocus) summaryPreview?.trigger.focus({ preventScroll: true });
    setSummaryPreview(null);
  };
  const leaveSummary = () => {
    keepSummary();
    if (summaryLayout.summaryInteraction !== "hover" || summaryPreview?.keyboard) return;
    // Leave enough time to cross the small gap between trigger and portal.
    summaryCloseTimer.current = setTimeout(() => setSummaryPreview(null), 160);
  };
  const previewEnabled = active && summaryLayout.summaryInteraction !== "sidebar" && !busy && !blocked && !loading && !error;
  useEffect(() => {
    if (!previewEnabled) {
      clearTimeout(summaryCloseTimer.current);
      setSummaryPreview(null);
    }
    return () => clearTimeout(summaryCloseTimer.current);
  }, [previewEnabled, summaryLayout.summaryInteraction]);
  const previewDocuments = useMemo(() => summaryPreview
    ? [...workspaceSummaryDocuments(documents, summaryPreview.kind, favorites, day)].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    : [], [documents, summaryPreview, favorites, day]);
  const previewTitle = summaryPreview ? { all: "全部文档", notes: "随记", today: "今日修改", favorites: "收藏", recent: "最近打开（最近编辑的 15 份）" }[summaryPreview.kind] : "";
  useEffect(() => {
    const refresh = () => setFavorites(readDocumentFavorites());
    window.addEventListener("storage", refresh);
    window.addEventListener(DOCUMENT_FAVORITES_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DOCUMENT_FAVORITES_CHANGED_EVENT, refresh);
    };
  }, []);
  const latestId = props.latestNote?.id;
  const latestUpdatedAt = props.latestNote?.updated_at;
  useEffect(() => {
    if (!latestId || !latestUpdatedAt) return;
    setDocuments(current => current.some(note => note.id === latestId && note.updated_at !== latestUpdatedAt)
      ? current.map(note => note.id === latestId ? { ...note, updated_at: latestUpdatedAt } : note) : current);
  }, [latestId, latestUpdatedAt]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    setFavorites(readDocumentFavorites());
    setRecent(readRecentNoteIds());
    void api.docs
      .tree()
      .then(
        (notes) => {
          if (!disposed) {
            setDocuments(workspaceDocuments(notes));
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
  }, [active, refreshKey, retry, noteId]);
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
  useEffect(() => {
    if (busy || blocked || !active || !props.desktop) setOpenAppearance(null);
  }, [busy, blocked, active, props.desktop]);
  const choose = (label: string, value: string, options: { value: string; label: string }[], patch: (value: string) => Partial<AppConfig>) =>
    props.desktop ? <DocumentFilterSelect key={label} label={label}
      text={options.find(option => option.value === value)?.label ?? value}
      className="exhibition-select" value={value} options={options} disabled={busy || blocked}
      open={openAppearance === label && !busy && !blocked}
      onOpenChange={open => setOpenAppearance(current => open ? label : current === label ? null : current)}
      onHover={() => setOpenAppearance(current => current === null ? null : label)}
      onChange={value => void run(() => props.onAppearance(patch(value)))} />
    : <label key={label}><select aria-label={label} disabled={busy || blocked} value={value}
        onChange={event => void run(() => props.onAppearance(patch(event.target.value)))}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>;
  const appearance = (
    <div className="exhibition-appearance">
      {choose("工作区风格", config?.interface_style === "calm-compact" ? "calm" : config?.interface_style ?? "calm",
        INTERFACE_STYLES.filter(style => style.value !== "classic"), value => ({ interface_style: value as AppConfig["interface_style"] }))}
      {choose("工作区配色", config?.interface_color_mode ?? "system",
        [{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }],
        value => ({ interface_color_mode: value as AppConfig["interface_color_mode"] }))}
      {props.desktop && <>
      {choose("文本宽度", config?.exhibition_text_width ?? "wide",
          [{ value: "narrow", label: "窄幅" }, { value: "standard", label: "标准" }, { value: "wide", label: "宽幅" }],
          value => ({ exhibition_text_width: value as AppConfig["exhibition_text_width"] }))}
        {choose("紧凑程度", density,
          [{ value: "comfortable", label: "舒适" }, { value: "compact", label: "紧凑" }],
          value => ({ exhibition_density: value as AppConfig["exhibition_density"] }))}
      </>}
    </div>
  );
  return (
    <div
      className={`exhibition-shell${active ? " is-exhibition" : ""}`}
      data-text-width={
        enabled && props.desktop
          ? (config?.exhibition_text_width ?? "wide")
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
            <nav className="exhibition-summary" data-mobile={!props.desktop || undefined} aria-label="工作区统计" aria-busy={loading}>
              {([
                ["all", "篇文档", "查看全部文档"],
                ["notes", "条随记", "查看随记"],
                ["today", "篇今日修改", "查看今日修改文档"],
                ["favorites", "篇收藏", "查看收藏文档"],
                ["recent", "最近打开", "查看最近打开文档"],
              ] as const).map(([kind, label, name]) => <button key={kind} type="button"
                className={`exhibition-summary-${kind}`} aria-label={name} aria-pressed={summaryLayout.summaryInteraction === "sidebar" ? props.activeSummary === kind : summaryPreview?.kind === kind}
                aria-haspopup={summaryLayout.summaryInteraction !== "sidebar" ? "dialog" : undefined} aria-expanded={summaryLayout.summaryInteraction !== "sidebar" ? summaryPreview?.kind === kind : undefined}
                onPointerEnter={event => { if (event.pointerType === "mouse" && previewEnabled && summaryLayout.summaryInteraction === "hover") { keepSummary(); setSummaryPreview({ kind, trigger: event.currentTarget, keyboard: false }); } }}
                onPointerLeave={leaveSummary}
                onKeyDown={event => {
                  if (event.key === "ArrowDown" && previewEnabled) { event.preventDefault(); keepSummary(); setSummaryPreview({ kind, trigger: event.currentTarget, keyboard: true }); }
                }}
                disabled={busy || blocked || loading || Boolean(error)} onClick={event => {
                  if (summaryLayout.summaryInteraction === "sidebar") { closeSummary(); props.onSummary(kind); return; }
                  if (summaryLayout.summaryInteraction === "click" && summaryPreview?.kind === kind) { closeSummary(); return; }
                  keepSummary(); setSummaryPreview({ kind, trigger: event.currentTarget, keyboard: false });
                }}>
                <strong>{loading || error ? "…" : counts[kind]}</strong><span>{label}</span>
              </button>)}
            </nav>
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
      {previewEnabled && summaryPreview && <WorkspaceSummaryPreview key={summaryPreview.kind} title={previewTitle} documents={previewDocuments}
        trigger={summaryPreview.trigger} keyboard={summaryPreview.keyboard} visibleRows={summaryLayout.summaryVisibleRows} compact={!props.desktop} onEnter={keepSummary} onLeave={leaveSummary} onClose={closeSummary}
        onOpen={id => { closeSummary(); open(id); }} />}
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
