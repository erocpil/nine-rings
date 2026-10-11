import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { DocumentEditSessions } from "../lib/document-edit-sessions";
import type { HostCommandContext } from "../lib/plugin-system/command-dispatcher";
import {
  activateBuiltinPilot,
  builtinDocumentStatistics,
  insertBuiltinDate,
} from "../lib/plugin-system/builtin-pilots";
import {
  readResultPresentation,
  subscribeResultPresentation,
  resultPresentationSnapshot,
  type DocumentTool,
} from "../lib/plugin-system/result-presentation";
import {
  documentToolEnabled,
  subscribeDocumentTools,
  documentToolsSnapshot,
} from "../lib/plugin-system/builtin-tool-preferences";
import { pluginRuntime } from "../lib/plugin-system/runtime";
import { PluginCommandMenu } from "./PluginCommandMenu";
import {
  DATE_FORMATS,
  formatPluginDate,
  type DateFormat,
} from "../lib/plugin-system/date-formats";
import { ToolbarIcon } from "./ToolbarIcon";

export function BuiltinPluginTools({
  sessions,
  context,
  active,
  disabled,
  readonly,
  onFocusEditor,
}: {
  sessions: DocumentEditSessions;
  context: HostCommandContext;
  active: boolean;
  disabled: boolean;
  readonly: boolean;
  onFocusEditor: () => void;
}) {
  const enabled = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.isEnabled,
  );
  useSyncExternalStore(subscribeResultPresentation, resultPresentationSnapshot);
  const button = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<DocumentTool>("date");
  const presentation = readResultPresentation(kind);
  const [placement, setPlacement] = useState<{
    target: HTMLElement | null;
    left: number;
    top: number;
    width: number;
  }>({ target: null, left: 0, top: 0, width: 0 });
  const toolsPreference = useSyncExternalStore(
    subscribeDocumentTools,
    documentToolsSnapshot,
  );
  const latest = useRef(context);
  latest.current = context;
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState("");
  const [statistics, setStatistics] = useState<ReturnType<
    typeof builtinDocumentStatistics
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const epoch = useRef(0);
  const session = useRef<Awaited<
    ReturnType<typeof activateBuiltinPilot>
  > | null>(null);
  const close = useCallback(() => {
    epoch.current++;
    setTrigger(null);
    setStatistics(null);
    setMessage("");
    setBusy(false);
    const current = session.current;
    session.current = null;
    void current?.dispose().catch(() => {});
  }, []);
  useEffect(() => {
    close();
    return close;
  }, [close, active, enabled, context.documentId, context.view]);
  useEffect(() => {
    if (!documentToolEnabled(kind)) close();
  }, [toolsPreference, kind, close]);
  const showingResult = Boolean(message || statistics);
  useEffect(() => {
    if (busy || !showingResult || statistics) return;
    const timer = window.setTimeout(close, 3000);
    return () => window.clearTimeout(timer);
  }, [busy, showingResult, statistics, close]);
  useEffect(() => {
    if (!active || (!busy && !showingResult) || trigger) return;
    const escape = (event: KeyboardEvent) => {
      // React may remove the result before passive listener cleanup runs.
      // A subsequent Esc must already belong to the surrounding workspace.
      if (!document.querySelector(".builtin-plugin-notice")) return;
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented)
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"], dialog')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    // Window capture precedes drawer/document listeners, regardless of mount order.
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [active, busy, showingResult, trigger, close]);
  const run = async (
    kind: "date" | "statistics",
    format: DateFormat = "date",
  ) => {
    if (
      running.current ||
      !enabled ||
      !active ||
      disabled ||
      !documentToolEnabled(kind)
    )
      return;
    close();
    setKind(kind);
    const version = epoch.current;
    running.current = true;
    setBusy(true);
    try {
      const current = await activateBuiltinPilot(
        kind,
        sessions,
        () => latest.current,
      );
      if (version !== epoch.current) {
        await current.dispose();
        return;
      }
      session.current = current;
      if (kind === "date") {
        // Menu buttons own focus. Restore the same live view before capturing
        // its target so native Cmd/Ctrl+Z works without another body click.
        onFocusEditor();
        await insertBuiltinDate(
          current.sdk,
          current.signal,
          new Date(),
          format,
        );
        if (version === epoch.current)
          setMessage(
            format === "date" ? "日期已插入并保存" : "时间已插入并保存",
          );
        await current.dispose();
        if (session.current === current) session.current = null;
      } else {
        let refreshing = false,
          again = false;
        const subscription: {
          value?: Awaited<ReturnType<typeof current.sdk.events.subscribe>>;
        } = {};
        const refresh = async () => {
          again = true;
          if (refreshing || !subscription.value) return;
          refreshing = true;
          try {
            while (
              again &&
              version === epoch.current &&
              !current.signal.aborted
            ) {
              again = false;
              await subscription.value.read({ signal: current.signal });
              const snapshot = await current.sdk.documents.snapshot({
                signal: current.signal,
              });
              if (version === epoch.current)
                setStatistics(builtinDocumentStatistics(snapshot.content));
            }
          } catch (error) {
            if (version === epoch.current) {
              setStatistics(null);
              setMessage(
                error instanceof Error ? error.message : "统计读取失败",
              );
            }
          } finally {
            refreshing = false;
          }
        };
        subscription.value = await current.sdk.events.subscribe({
          signal: current.signal,
          onAvailable: () => {
            void refresh();
          },
        });
        if (version === epoch.current)
          setStatistics(
            builtinDocumentStatistics(subscription.value.snapshot.content),
          );
        if (again) void refresh();
        current.signal.addEventListener(
          "abort",
          () => {
            if (version === epoch.current) close();
          },
          { once: true },
        );
      }
    } catch (error) {
      if (version === epoch.current) {
        setMessage(error instanceof Error ? error.message : "插件执行失败");
        const current = session.current;
        session.current = null;
        await current?.dispose().catch(() => {});
      }
    } finally {
      running.current = false;
      if (version === epoch.current) setBusy(false);
    }
  };
  useLayoutEffect(() => {
    if (!active || (!busy && !showingResult)) return;
    const root = button.current?.closest<HTMLElement>(".note-editor");
    const update = () => {
      const bounds = root?.getBoundingClientRect();
      const left = Math.max(16, bounds?.left ?? 16);
      const right = Math.min(
        window.innerWidth - 16,
        bounds?.right ?? window.innerWidth - 16,
      );
      const top = Math.max(16, bounds?.top ?? 16);
      const bottom = Math.min(
        window.innerHeight - 32,
        bounds?.bottom ?? window.innerHeight - 32,
      );
      const status = root?.querySelector<HTMLElement>(".editor-stats");
      setPlacement({
        target:
          presentation.surface === "status" &&
          status &&
          status.getBoundingClientRect().height > 0
            ? status
            : null,
        left: (left + right) / 2,
        top:
          presentation.position === "top"
            ? top + 16
            : presentation.position === "center"
              ? (top + bottom) / 2
              : bottom - 16,
        width: Math.max(0, right - left),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (root) observer.observe(root);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [
    active,
    busy,
    showingResult,
    presentation.surface,
    presentation.position,
  ]);
  if (!enabled || !active) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="markdown-view-toggle"
        title="内置插件"
        aria-label="内置插件"
        aria-haspopup="menu"
        aria-expanded={Boolean(trigger)}
        disabled={disabled || busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => setTrigger(trigger ? null : event.currentTarget)}
      >
        <ToolbarIcon name="plus" />
      </button>
      {trigger && (
        <PluginCommandMenu
          trigger={trigger}
          onClose={() => setTrigger(null)}
          actions={[
            {
              label: "插入日期与时间",
              children: DATE_FORMATS.map((option) => ({
                label: `${option.label} · ${formatPluginDate(new Date(), option.id)}`,
                run: () => {
                  void run("date", option.id);
                },
              })),
              disabled: readonly || !documentToolEnabled("date"),
              run: () => {
                void run("date");
              },
            },
            {
              label: "当前文档统计",
              disabled: !documentToolEnabled("statistics"),
              run: () => {
                void run("statistics");
              },
            },
          ]}
        />
      )}
      {(busy || message || statistics) &&
        createPortal(
          <aside
            className={`builtin-plugin-notice${placement.target ? " builtin-plugin-status" : ""}`}
            aria-label="内置插件结果"
            data-position={presentation.position}
            style={
              placement.target
                ? undefined
                : {
                    left: placement.left,
                    top: placement.top,
                    bottom: "auto",
                    maxWidth: placement.width,
                    transform: `translate(-50%, ${presentation.position === "top" ? "0" : presentation.position === "center" ? "-50%" : "-100%"})`,
                  }
            }
          >
            <button
              type="button"
              className="btn-icon"
              aria-label="关闭插件结果"
              onMouseDown={(event) => event.preventDefault()}
              onClick={close}
            >
              <ToolbarIcon name="close" />
            </button>
            <div role="status">
              {busy
                ? "正在处理…"
                : statistics
                  ? `正文字符 ${statistics.characters} · 非空白字符 ${statistics.nonWhitespace} · 文本行 ${statistics.lines}`
                  : message}
            </div>
            {statistics && !placement.target && (
              <small>统计当前正文，包含未保存修改；不含文档标题。</small>
            )}
          </aside>,
          placement.target || document.body,
        )}
    </>
  );
}
