import {
  useCallback,
  useEffect,
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
import { pluginRuntime } from "../lib/plugin-system/runtime";
import { BlockActionMenu } from "./BlockActionMenu";
import { ToolbarIcon } from "./ToolbarIcon";

export function BuiltinPluginTools({
  sessions,
  context,
  active,
  disabled,
  readonly,
}: {
  sessions: DocumentEditSessions;
  context: HostCommandContext;
  active: boolean;
  disabled: boolean;
  readonly: boolean;
}) {
  const enabled = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.isEnabled,
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
  const run = async (kind: "date" | "statistics") => {
    if (running.current || !enabled || !active || disabled) return;
    close();
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
        await insertBuiltinDate(current.sdk, current.signal);
        if (version === epoch.current) setMessage("日期已插入并保存");
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
  if (!enabled || !active) return null;
  return (
    <>
      <button
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
        <BlockActionMenu
          trigger={trigger}
          placement="below"
          title="内置插件"
          onClose={() => setTrigger(null)}
          actions={[
            {
              label: "插入当前日期",
              disabled: readonly,
              run: () => {
                void run("date");
              },
            },
            {
              label: "当前文档统计",
              run: () => {
                void run("statistics");
              },
            },
          ]}
        />
      )}
      {(busy || message || statistics) &&
        createPortal(
          <aside className="builtin-plugin-notice" aria-label="内置插件结果">
            <button
              type="button"
              className="btn-icon"
              aria-label="关闭插件结果"
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
            {statistics && (
              <small>统计当前正文，包含未保存修改；不含文档标题。</small>
            )}
          </aside>,
          document.body,
        )}
    </>
  );
}
