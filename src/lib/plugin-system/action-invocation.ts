import { api } from "../api";
import { isPathUnder } from "../storage/core";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../storage/protection-state";
import type {
  DocumentEditSessions,
  DocumentEditTarget,
} from "../document-edit-sessions";
import {
  actionResources,
  MACRO_COMMANDS,
  type MacroCommand,
  type RegisteredAction,
} from "./action-resources";
import { contentResources, expandContent } from "./content-resources";
import {
  HostCommandDispatcher,
  type HostCommandContext,
} from "./command-dispatcher";
import { PluginHostError, pluginRuntime } from "./runtime";
import { formatPluginDate, type DateFormat } from "./date-formats";
import { builtinDocumentStatistics } from "./builtin-pilots";
import { runQuery } from "./query-resources";
import type { ParameterValues } from "./command-parameters";

export async function readDeclarativeQuery(
  entry: RegisteredAction,
  values: ParameterValues,
  signal: AbortSignal,
) {
  const check = () => {
    actionResources.assert(entry);
    pluginRuntime.assert(entry.activation, "documents.metadata.read");
    if (signal.aborted) throw new PluginHostError("CANCELLED", "查询已取消");
  };
  check();
  if (entry.value.kind !== "query")
    throw new PluginHostError("INVALID_ARGUMENT", "不是查询扩展");
  const query = entry.value;
  return withProtectionWrite(async () => {
    check();
    const [rows, paths] = await Promise.all([
      api.docs.summaries(),
      listProtectedPaths(),
    ]);
    check();
    if (rows.length > 50000)
      throw new PluginHostError(
        "INVALID_ARGUMENT",
        "元数据查询最多处理 50000 份文档，请缩小工作区",
      );
    const result = runQuery(
      query,
      rows.filter(
        (row) =>
          !paths.some((path) =>
            isPathUnder(row.storagePath ?? "references", path.path),
          ),
      ),
      values,
    );
    check();
    return result;
  });
}

export class MacroExecutionError extends Error {
  constructor(
    readonly completed: number,
    readonly total: number,
    readonly applied: boolean,
    reason: string,
  ) {
    super(
      `宏在 ${completed}/${total} 步后停止${applied ? "；当前步已修改文档" : ""}：${reason}。已完成的修改保留，不自动重试或回滚。`,
    );
  }
}
/** No dynamic dispatch to plugin code: only reviewed host commands may enter this dispatcher. */
export async function executeDeclarativeMacro(
  entry: RegisteredAction,
  sessions: DocumentEditSessions,
  context: () => HostCommandContext,
  signal: AbortSignal,
  progress: (completed: number, total: number) => void,
) {
  actionResources.assert(entry);
  if (entry.value.kind !== "macro")
    throw new PluginHostError("INVALID_ARGUMENT", "不是宏扩展");
  const macro = entry.value;
  const initial = { ...context() };
  let checkpoint: DocumentEditTarget | undefined =
    macro.writes && initial.documentId
      ? sessions.capture(initial.documentId)
      : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const release = pluginRuntime.own(entry.activation, abort);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 60000);
  const dispatcher = new HostCommandDispatcher(
    pluginRuntime,
    sessions,
    context,
  );
  const cleanup: (() => void)[] = [];
  const aliases = new Map<MacroCommand, string>();
  const check = () => {
    actionResources.assert(entry);
    if (signal.aborted || controller.signal.aborted)
      throw new PluginHostError("CANCELLED", "宏已取消或超过 60 秒");
    const current = context();
    if (
      current.documentId !== initial.documentId ||
      current.view !== initial.view ||
      current.platform !== initial.platform
    )
      throw new PluginHostError("STALE_TARGET", "宏运行期间文档或视图已变化");
    if (checkpoint) sessions.validate(checkpoint);
  };
  let completed = 0,
    applied = false;
  const results: unknown[] = [];
  try {
    check();
    // Validate/register the complete fixed command set before the first side effect.
    for (const command of new Set(macro.steps.map((step) => step.command))) {
      const id = `${entry.activation.pluginId}.macro-host-${aliases.size}`;
      const read = command === "nine-rings.document.statistics";
      aliases.set(command, id);
      cleanup.push(
        dispatcher.register(
          entry.activation,
          {
            id,
            scope: read ? "document" : "selection",
            risk: read ? "read" : "write",
            args: MACRO_COMMANDS[command],
            views: read
              ? ["render", "source", "readonly"]
              : ["render", "source"],
            exposure: { palette: false, macro: true },
          },
          async (ctx) => {
            check();
            if (read)
              return builtinDocumentStatistics(
                (await dispatcher.snapshot(entry.activation, ctx.signal)).value
                  .content,
              );
            let input: { type: "text" | "markdown"; value: string };
            if (command === "nine-rings.template.insert") {
              const template = contentResources
                .getSnapshot()
                .find(
                  (value) =>
                    value.activation === entry.activation &&
                    value.value.id ===
                      `${entry.activation.pluginId}/template/${String(ctx.args.templateId).slice(entry.activation.pluginId.length + 1)}`,
                );
              if (!template)
                throw new PluginHostError("INVALID_ARGUMENT", "宏模板已撤回");
              contentResources.assert(template);
              const expanded = expandContent(
                template.value,
                Object.fromEntries(
                  template.value.fields.map((field) => [
                    field.id,
                    field.default,
                  ]),
                ),
              );
              input = { type: expanded.format, value: expanded.value };
            } else
              input = {
                type:
                  command === "nine-rings.editor.insert-markdown"
                    ? "markdown"
                    : "text",
                value:
                  command === "nine-rings.editor.insert-date"
                    ? formatPluginDate(
                        new Date(),
                        ctx.args.format as DateFormat,
                      )
                    : String(ctx.args.value),
              };
            await ctx.commit(input);
            applied = true;
            // Retain the selection immediately after our own edit; human input while
            // awaiting persistence invalidates the remaining macro instead of redirecting it.
            checkpoint = sessions.capture(ctx.documentId!);
            await sessions.whenSaved(
              ctx.documentId!,
              sessions.readRevision(ctx.documentId!),
              ctx.signal,
            );
            check();
            return null;
          },
        ),
      );
    }
    progress(0, macro.steps.length);
    for (const step of macro.steps) {
      check();
      applied = false;
      const result = await dispatcher.execute(
        entry.activation,
        {
          requestId: crypto.randomUUID(),
          commandId: aliases.get(step.command)!,
          entry: "macro",
          args: step.args,
        },
        { signal: controller.signal, timeoutMs: 30000 },
      );
      if (!result.ok) {
        applied ||= result.applied;
        throw new PluginHostError(result.error.code, result.error.message);
      }
      results.push(result.value);
      completed++;
      check();
      progress(completed, macro.steps.length);
    }
    return { completed, results };
  } catch (error) {
    throw new MacroExecutionError(
      completed,
      macro.steps.length,
      applied,
      error instanceof Error ? error.message : "执行失败",
    );
  } finally {
    clearTimeout(timer);
    cleanup.reverse().forEach((dispose) => dispose());
    signal.removeEventListener("abort", abort);
    release();
  }
}
