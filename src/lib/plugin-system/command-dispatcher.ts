import {
  compileCommandArguments,
  type CommandArguments,
} from "./command-arguments";
import { DocumentIntentService } from "./document-intents";
import {
  PluginHostError,
  type PluginActivation,
  type PluginErrorCode,
  type PluginRuntime,
} from "./runtime";
import type {
  DocumentEditSessions,
  DocumentEditTarget,
  InsertDocumentContent,
} from "../document-edit-sessions";

export type CommandPlatform = "web" | "tauri";
export type CommandView = "render" | "source" | "readonly" | "pdf" | "epub";
export interface HostCommandContext {
  platform: CommandPlatform;
  view: CommandView;
  documentId?: string;
}
export interface HostCommandDeclaration {
  id: string;
  scope: "app" | "workspace" | "document" | "selection";
  risk: "read" | "write" | "destructive";
  args?: unknown;
  views?: readonly CommandView[];
  platforms?: readonly CommandPlatform[];
  exposure?: Partial<
    Record<"palette" | "keybinding" | "menu" | "macro", boolean>
  >;
}
interface RunContext {
  readonly args: Readonly<CommandArguments>;
  readonly signal: AbortSignal;
  readonly documentId?: string;
  commit(content: InsertDocumentContent): Promise<void>;
}
export type CommandResponse =
  | { ok: true; requestId: string; applied: boolean; value: unknown }
  | {
      ok: false;
      requestId: string;
      applied: boolean;
      error: { code: PluginErrorCode; message: string };
    };
type Handler = (context: RunContext) => unknown | Promise<unknown>;
interface Registered {
  activation: PluginActivation;
  definition: HostCommandDeclaration;
  arguments: ReturnType<typeof compileCommandArguments>;
  handler: Handler;
}

/** Internal host dispatcher. Registration and context factories are host-owned;
 * no extension script or serializable SDK registration is enabled here. */
export class HostCommandDispatcher {
  private commands = new Map<string, Registered>();
  private requests = new WeakMap<PluginActivation, Set<string>>();
  private activeRequests = 0;
  private intents: DocumentIntentService;
  constructor(
    private runtime: PluginRuntime,
    private sessions: DocumentEditSessions,
    private context: () => HostCommandContext,
    private confirm?: (commandId: string) => Promise<boolean>,
  ) {
    this.intents = new DocumentIntentService(runtime, sessions);
  }

  capabilities(activation: PluginActivation, entry: "palette" | "keybinding" | "menu" | "macro" = "palette") {
    const permissions = this.runtime.permissions(activation);
    const context = this.context();
    const commands = [...this.commands.values()].filter(command => {
      const definition = command.definition;
      if (command.activation !== activation || !definition.exposure![entry] ||
          !definition.platforms!.includes(context.platform) || !definition.views!.includes(context.view)) return false;
      if (["document", "selection"].includes(definition.scope)) {
        if (!context.documentId || !this.sessions.active(context.documentId)) return false;
        if (!permissions.includes(definition.risk === "read" ? "documents.current.read" : "editor.selection.write")) return false;
      }
      return true;
    }).map(({ definition }) => ({ id: definition.id, scope: definition.scope, risk: definition.risk }));
    return { protocol: 1 as const, platform: context.platform, view: context.view, permissions, commands };
  }

  register(
    activation: PluginActivation,
    declaration: HostCommandDeclaration,
    handler: Handler,
  ): () => void {
    this.runtime.assert(activation);
    const scope = ["app", "workspace", "document", "selection"].includes(
      declaration.scope,
    );
    const risk = ["read", "write", "destructive"].includes(declaration.risk);
    if (
      !declaration.id.startsWith(`${activation.pluginId}.`) ||
      !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(declaration.id) ||
      !scope ||
      !risk ||
      typeof handler !== "function"
    )
      throw new PluginHostError("INVALID_ARGUMENT", "命令声明无效");
    if (declaration.risk !== "read" && declaration.scope !== "selection")
      throw new PluginHostError(
        "INVALID_ARGUMENT",
        "首期写命令只开放当前编辑选区",
      );
    const views = [...(declaration.views ?? ["render", "source"])];
    const platforms = [...(declaration.platforms ?? ["web", "tauri"])];
    const exposure = {
      palette: true,
      keybinding: false,
      menu: false,
      macro: false,
      ...declaration.exposure,
    };
    if (
      !views.length ||
      views.length > 5 ||
      views.some(
        (view) =>
          !["render", "source", "readonly", "pdf", "epub"].includes(view),
      ) ||
      new Set(views).size !== views.length ||
      !platforms.length ||
      platforms.length > 2 ||
      platforms.some((platform) => !["web", "tauri"].includes(platform)) ||
      new Set(platforms).size !== platforms.length ||
      Object.entries(exposure).some(
        ([key, value]) =>
          !["palette", "keybinding", "menu", "macro"].includes(key) ||
          typeof value !== "boolean",
      ) ||
      (declaration.risk === "destructive" && (exposure.macro || !this.confirm))
    )
      throw new PluginHostError("INVALID_ARGUMENT", "命令范围或确认规则无效");
    const existing = this.commands.get(declaration.id);
    if (existing) {
      try {
        this.runtime.assert(existing.activation);
        throw new PluginHostError("INVALID_ARGUMENT", "命令已注册");
      } catch (error) {
        if (
          !(error instanceof PluginHostError) ||
          error.code !== "PLUGIN_DISABLED"
        )
          throw error;
      }
    }
    let compiled;
    try {
      compiled = compileCommandArguments(declaration.args);
    } catch {
      throw new PluginHostError("INVALID_ARGUMENT", "命令参数声明无效");
    }
    const command: Registered = {
      activation,
      definition: Object.freeze({ ...declaration, views, platforms, exposure }),
      arguments: compiled,
      handler,
    };
    this.commands.set(declaration.id, command);
    return () => {
      if (this.commands.get(declaration.id) === command)
        this.commands.delete(declaration.id);
    };
  }

  async execute(
    activation: PluginActivation,
    request: {
      requestId: string;
      commandId: string;
      args?: unknown;
      entry?: "palette" | "keybinding" | "menu" | "macro";
    },
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CommandResponse> {
    const requestId =
      typeof request.requestId === "string" && request.requestId.length <= 128
        ? request.requestId
        : "invalid";
    let applied = false;
    let release = () => {};
    try {
      const runtimeSignal = this.runtime.assert(activation);
      if (
        !requestId ||
        requestId === "invalid" ||
        !/^[a-zA-Z0-9:_-]+$/.test(requestId)
      )
        throw new PluginHostError("INVALID_ARGUMENT", "请求身份无效");
      const seen = this.requests.get(activation) ?? new Set<string>();
      if (seen.has(requestId))
        throw new PluginHostError(
          "DUPLICATE_REQUEST",
          "请求已执行或正在执行，不能重复提交",
        );
      if (seen.size >= 4096 || this.activeRequests >= 32)
        throw new PluginHostError("INVALID_ARGUMENT", "命令请求超过会话预算");
      const command = this.commands.get(request.commandId);
      if (!command || command.activation !== activation)
        throw new PluginHostError("COMMAND_NOT_FOUND", "命令不可用");
      const entry = request.entry ?? "palette";
      if (
        !Object.prototype.hasOwnProperty.call(
          command.definition.exposure!,
          entry,
        ) ||
        !command.definition.exposure![entry]
      )
        throw new PluginHostError("PERMISSION_DENIED", "命令未开放此入口");
      const prepared = command.arguments.prepare(request.args ?? {});
      if (!prepared.ok || prepared.missing.length)
        throw new PluginHostError("INVALID_ARGUMENT", "命令参数无效或不完整");
      const host = this.context();
      if (!command.definition.platforms!.includes(host.platform))
        throw new PluginHostError(
          "UNSUPPORTED_PLATFORM",
          "当前平台不支持此命令",
        );
      if (!command.definition.views!.includes(host.view))
        throw new PluginHostError("UNSUPPORTED_VIEW", "当前视图不支持此命令");
      const documentScope = ["document", "selection"].includes(
        command.definition.scope,
      );
      if (
        documentScope &&
        (!host.documentId || !this.sessions.active(host.documentId))
      )
        throw new PluginHostError("STALE_TARGET", "没有活动文档");
      if (documentScope)
        this.runtime.assert(
          activation,
          command.definition.risk === "read"
            ? "documents.current.read"
            : "editor.selection.write",
        );
      let target: DocumentEditTarget | undefined;
      if (command.definition.scope === "selection") {
        try {
          target = this.sessions.capture(host.documentId!);
        } catch {
          throw new PluginHostError("STALE_TARGET", "当前编辑选区不可用");
        }
      }
      const timeout = options.timeoutMs ?? 30000;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000)
        throw new PluginHostError("INVALID_ARGUMENT", "命令超时预算无效");
      seen.add(requestId);
      this.requests.set(activation, seen);
      this.activeRequests += 1;
      const controller = new AbortController();
      let terminal: PluginHostError | undefined;
      let rejectAbort!: (error: PluginHostError) => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      const abort = (code: "PLUGIN_DISABLED" | "CANCELLED" | "TIMEOUT") => {
        if (terminal) return;
        terminal = new PluginHostError(
          code,
          code === "TIMEOUT"
            ? "命令已超时"
            : code === "PLUGIN_DISABLED"
              ? "插件已停用"
              : "命令已取消",
        );
        controller.abort();
        rejectAbort(terminal);
      };
      const disabled = () => abort("PLUGIN_DISABLED");
      const cancelled = () => abort("CANCELLED");
      runtimeSignal.addEventListener("abort", disabled, { once: true });
      options.signal?.addEventListener("abort", cancelled, { once: true });
      const timer = setTimeout(() => abort("TIMEOUT"), timeout);
      release = () => {
        clearTimeout(timer);
        runtimeSignal.removeEventListener("abort", disabled);
        options.signal?.removeEventListener("abort", cancelled);
        this.activeRequests -= 1;
      };
      if (options.signal?.aborted) cancelled();
      let commitRequested = false;
      let pendingCommit: Promise<unknown> | undefined;
      let finished = false;
      const cleanup = release;
      release = () => {
        finished = true;
        controller.abort();
        cleanup();
      };
      const run = async () => {
        if (terminal) throw terminal;
        if (
          command.definition.risk === "destructive" &&
          !(await this.confirm!(command.definition.id))
        )
          throw new PluginHostError("CANCELLED", "命令确认已取消");
        if (terminal) throw terminal;
        const value = await command.handler(
          Object.freeze({
            args: Object.freeze(structuredClone(prepared.args)),
            signal: controller.signal,
            documentId: host.documentId,
            commit: async (content: InsertDocumentContent) => {
              if (terminal) throw terminal;
              if (finished)
                throw new PluginHostError("CANCELLED", "命令已结束");
              this.runtime.assert(activation, "editor.selection.write");
              if (
                !target ||
                command.definition.risk === "read" ||
                commitRequested
              )
                throw new PluginHostError(
                  "PERMISSION_DENIED",
                  "此命令不能执行该编辑批次",
                );
              commitRequested = true;
              pendingCommit = this.intents.insert(
                activation,
                target,
                content,
                controller.signal,
                () => {
                  applied = true;
                },
              );
              await pendingCommit;
            },
          }),
        );
        if (pendingCommit) await pendingCommit;
        if (terminal) throw terminal;
        this.runtime.assert(activation);
        const current = this.context();
        if (
          !applied &&
          (current.documentId !== host.documentId ||
            current.view !== host.view ||
            current.platform !== host.platform)
        )
          throw new PluginHostError("STALE_TARGET", "命令上下文已变化");
        if (!applied && target) {
          try {
            this.sessions.validate(target);
          } catch {
            throw new PluginHostError("STALE_TARGET", "编辑目标已变化");
          }
        }
        // Host results are JSON values, bounded before any future wire encoding.
        if (value === undefined) return null;
        const serialized = JSON.stringify(value);
        if (serialized === undefined || serialized.length > 100000)
          throw new PluginHostError("INVALID_ARGUMENT", "命令结果超出限制");
        return JSON.parse(serialized) as unknown;
      };
      const value = await Promise.race([run(), aborted]);
      return { ok: true, requestId, applied, value };
    } catch (error) {
      const safe =
        error instanceof PluginHostError
          ? error
          : new PluginHostError("INTERNAL_ERROR", "命令执行失败");
      return {
        ok: false,
        requestId,
        applied,
        error: { code: safe.code, message: safe.message },
      };
    } finally {
      release();
    }
  }
}
