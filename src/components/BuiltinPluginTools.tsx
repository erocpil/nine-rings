import {
  actionResources,
  type RegisteredAction,
} from "../lib/plugin-system/action-resources";
import {
  executeDeclarativeMacro,
  readDeclarativeQuery,
} from "../lib/plugin-system/action-invocation";
import type { QueryRow } from "../lib/plugin-system/query-resources";
import { PluginQueryResults } from "./PluginQueryResults";
import type { Note } from "../types/models";
import {
  contentResources,
  type RegisteredContent,
} from "../lib/plugin-system/content-resources";
import { insertDeclarativeContent } from "../lib/plugin-system/content-invocation";
import {
  IMAGE_INSERT_EVENT,
  type ViewedImage,
} from "../lib/image-library/viewer-request";
import { imageDirectoryService } from "../lib/image-library/directory-service";
import { validateParameterValues } from "../lib/plugin-system/command-parameters";
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
  insertBuiltinMarkdown,
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
import {
  IMAGE_FIELDS,
  imageCommandMarkdown,
} from "../lib/plugin-system/image-command";
import type { ParameterValues } from "../lib/plugin-system/command-parameters";
import { PluginCommandMenu } from "./PluginCommandMenu";
import {
  DATE_FORMATS,
  formatPluginDate,
  type DateFormat,
} from "../lib/plugin-system/date-formats";
import { storePluginImage } from "../lib/plugin-system/local-image";
import { ToolbarIcon } from "./ToolbarIcon";

export function BuiltinPluginTools({
  sessions,
  context,
  active,
  disabled,
  readonly,
  onFocusEditor,
  onOpenNote,
}: {
  sessions: DocumentEditSessions;
  context: HostCommandContext;
  active: boolean;
  disabled: boolean;
  readonly: boolean;
  onFocusEditor: () => void;
  onOpenNote?: (note: Note) => Promise<void>;
}) {
  const enabled = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.isEnabled,
  );
  useSyncExternalStore(subscribeResultPresentation, resultPresentationSnapshot);
  const content = useSyncExternalStore(
    contentResources.subscribe,
    contentResources.getSnapshot,
  );
  const actions = useSyncExternalStore(
    actionResources.subscribe,
    actionResources.getSnapshot,
  );
  const [queryResult, setQueryResult] = useState<{
    entry: RegisteredAction;
    rows: readonly QueryRow[];
  } | null>(null);
  const contentAbort = useRef<AbortController | null>(null);
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
    contentAbort.current?.abort();
    contentAbort.current = null;
    setTrigger(null);
    setStatistics(null);
    setQueryResult(null);
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
  useEffect(() => {
    if (queryResult && !actions.includes(queryResult.entry)) close();
  }, [actions, queryResult, close]);
  const runAction = async (
    entry: RegisteredAction,
    values: ParameterValues,
  ) => {
    if (
      running.current ||
      !enabled ||
      !active ||
      disabled ||
      (readonly && entry.value.kind === "macro" && entry.value.writes)
    )
      return;
    close();
    const version = epoch.current,
      controller = new AbortController();
    contentAbort.current = controller;
    running.current = true;
    setBusy(true);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (version !== epoch.current || controller.signal.aborted) return;
      if (entry.value.kind === "query") {
        setMessage("正在查询文档元数据…");
        const rows = await readDeclarativeQuery(
          entry,
          values,
          controller.signal,
        );
        if (version === epoch.current) {
          setMessage("");
          setQueryResult({ entry, rows });
        }
      } else {
        if (entry.value.writes) onFocusEditor();
        const result = await executeDeclarativeMacro(
          entry,
          sessions,
          () => latest.current,
          controller.signal,
          (done, total) => {
            if (version === epoch.current)
              setMessage(`宏正在执行 ${done}/${total} 步…`);
          },
        );
        if (version === epoch.current) {
          const stats = [...result.results]
            .reverse()
            .find(
              (value) =>
                value && typeof value === "object" && "characters" in value,
            ) as { characters: number; lines: number } | undefined;
          setMessage(
            `宏已完成 ${result.completed} 步${stats ? ` · ${stats.characters} 字符 / ${stats.lines} 行` : ""}`,
          );
        }
      }
    } catch (error) {
      if (version === epoch.current)
        setMessage(error instanceof Error ? error.message : "扩展执行失败");
    } finally {
      if (contentAbort.current === controller) contentAbort.current = null;
      running.current = false;
      if (version === epoch.current) setBusy(false);
    }
  };
  const runContent = async (
    entry: RegisteredContent,
    values: ParameterValues,
  ) => {
    if (running.current || !enabled || !active || disabled || readonly) return;
    close();
    const version = epoch.current;
    const controller = new AbortController();
    contentAbort.current = controller;
    running.current = true;
    setBusy(true);
    try {
      // A native parameter dialog restores focus when it unmounts. Let that
      // cleanup finish before focusing/capturing the original editor selection.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (version !== epoch.current || controller.signal.aborted) return;
      onFocusEditor();
      await insertDeclarativeContent(
        entry,
        values,
        sessions,
        () => latest.current,
        controller.signal,
      );
      if (version === epoch.current) setMessage("内容已插入并保存");
    } catch (error) {
      if (version === epoch.current)
        setMessage(error instanceof Error ? error.message : "插入失败");
    } finally {
      if (contentAbort.current === controller) contentAbort.current = null;
      running.current = false;
      if (version === epoch.current) setBusy(false);
    }
  };
  const run = async (
    kind: DocumentTool,
    format: DateFormat = "date",
    markdown?: string | ((signal: AbortSignal) => Promise<string>),
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
      if (kind !== "statistics") {
        // Menu buttons own focus. Restore the same live view before capturing
        // its target so native Cmd/Ctrl+Z works without another body click.
        onFocusEditor();
        if (kind === "image")
          await insertBuiltinMarkdown(current.sdk, current.signal, markdown!);
        else
          await insertBuiltinDate(
            current.sdk,
            current.signal,
            new Date(),
            format,
          );
        if (version === epoch.current)
          setMessage(
            kind === "image"
              ? "图片已插入并保存"
              : format === "date"
                ? "日期已插入并保存"
                : "时间已插入并保存",
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
  const imageRun = useRef(run);
  imageRun.current = run;
  useEffect(() => {
    if (!active || !enabled || readonly || disabled) return;
    const insert = (event: Event) => {
      const image = (event as CustomEvent<ViewedImage>).detail;
      if (!image || !documentToolEnabled("image")) return;
      const values = validateParameterValues(IMAGE_FIELDS, {
        alt: image.name || "图片",
        title: "",
        src: "/icon-192.svg",
      });
      if (image.rootId && image.nodeId) {
        void imageRun.current("image", "date", async (signal) => {
          const blob = await imageDirectoryService.read(
            image.rootId!,
            image.nodeId!,
          );
          const ref = await storePluginImage(
            new File([blob], image.name, { type: blob.type }),
            context.documentId!,
            signal,
          );
          return imageCommandMarkdown(values, undefined, ref);
        });
      } else if (
        /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(image.src)
      ) {
        void imageRun.current("image", "date", async (signal) => {
          const blob = await (await fetch(image.src, { signal })).blob();
          const ref = await storePluginImage(
            new File([blob], image.name, { type: blob.type }),
            context.documentId!,
            signal,
          );
          return imageCommandMarkdown(values, undefined, ref);
        });
      } else {
        try {
          const markdown = image.src.startsWith("nr-image://")
            ? imageCommandMarkdown(values, undefined, image.src)
            : imageCommandMarkdown({ ...values, src: image.src });
          void imageRun.current("image", "date", markdown);
        } catch (cause) {
          setMessage(cause instanceof Error ? cause.message : "无法插入图片");
        }
      }
    };
    window.addEventListener(IMAGE_INSERT_EVENT, insert);
    return () => window.removeEventListener(IMAGE_INSERT_EVENT, insert);
  }, [active, enabled, readonly, disabled, context.documentId]);
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
        title={content.length || actions.length ? "插件" : "内置插件"}
        data-can-insert-image={
          !readonly && !disabled && !busy && documentToolEnabled("image")
            ? "true"
            : undefined
        }
        aria-label={content.length || actions.length ? "插件" : "内置插件"}
        aria-haspopup="menu"
        aria-expanded={Boolean(trigger)}
        disabled={disabled || busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => setTrigger(trigger ? null : event.currentTarget)}
      >
        <ToolbarIcon name="plus" />
      </button>
      {queryResult && (
        <PluginQueryResults
          entry={queryResult.entry}
          rows={queryResult.rows}
          onClose={close}
          onOpen={onOpenNote}
        />
      )}
      {trigger && (
        <PluginCommandMenu
          trigger={trigger}
          title={content.length || actions.length ? "插件" : "内置插件"}
          onClose={() => setTrigger(null)}
          commands={[
            ...actions.map((entry) => ({
              label: `${entry.value.kind === "macro" ? "宏" : "查询"} · ${entry.value.name} (${entry.value.id})`,
              disabled:
                disabled ||
                busy ||
                (readonly &&
                  entry.value.kind === "macro" &&
                  entry.value.writes),
              parameters:
                entry.value.kind === "query" && entry.value.fields.length
                  ? { kind: "form" as const, fields: entry.value.fields }
                  : { kind: "none" as const },
              run: (values: ParameterValues) => {
                void runAction(entry, values);
              },
            })),
            ...content
              .filter(
                (entry) =>
                  entry.value.usage.includes("insert") &&
                  entry.value.views.includes(
                    context.view === "source" ? "source" : "render",
                  ),
              )
              .map((entry) => ({
                label: `${entry.value.kind === "template" ? "模板" : "片段"} · ${entry.value.name} (${entry.value.id})`,
                disabled: readonly || disabled || busy,
                parameters: entry.value.fields.length
                  ? { kind: "form" as const, fields: entry.value.fields }
                  : { kind: "none" as const },
                run: (values: ParameterValues) => {
                  void runContent(entry, values);
                },
              })),
            {
              label: "插入日期与时间",
              parameters: {
                kind: "choices",
                choices: DATE_FORMATS.map((option) => ({
                  label: `${option.label} · ${formatPluginDate(new Date(), option.id)}`,
                  values: { format: option.id },
                })),
              },
              disabled: readonly || !documentToolEnabled("date"),
              run: (values) => {
                void run("date", values.format as DateFormat);
              },
            },
            {
              label: "当前文档统计",
              parameters: { kind: "none" },
              disabled: !documentToolEnabled("statistics"),
              run: () => {
                void run("statistics");
              },
            },
            {
              label: "插入图片",
              disabled: readonly || !documentToolEnabled("image"),
              parameters: { kind: "form", fields: IMAGE_FIELDS },
              run: (values: ParameterValues, files) => {
                const id =
                  values.kind === "reference"
                    ? `${String(values.reference)}-${crypto.randomUUID().slice(0, 8)}`
                    : undefined;
                // Validate non-file parameters before closing the form. Only the host
                // creates local references; typed executable URLs remain rejected.
                imageCommandMarkdown(
                  files?.src ? { ...values, src: "/icon-192.svg" } : values,
                  id,
                );
                const markdown = files?.src
                  ? async (signal: AbortSignal) => {
                      const ref = await storePluginImage(
                        files.src,
                        context.documentId!,
                        signal,
                      );
                      return imageCommandMarkdown(values, id, ref);
                    }
                  : imageCommandMarkdown(values, id);
                void run("image", "date", markdown);
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
