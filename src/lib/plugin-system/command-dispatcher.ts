import {
  compileCommandArguments,
  type CommandArguments,
} from "./command-arguments";
import { api } from "../api";
import { isEncrypted } from "../document-crypto";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../storage/protection-state";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import { DocumentIntentService } from "./document-intents";
import {
  SaveBarrierError,
  type DocumentSaveRevision,
} from "../document-save-revisions";
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

  capabilities(
    activation: PluginActivation,
    entry: "palette" | "keybinding" | "menu" | "macro" = "palette",
  ) {
    const permissions = this.runtime.permissions(activation);
    const context = this.context();
    const commands = [...this.commands.values()]
      .filter((command) => {
        const definition = command.definition;
        if (
          command.activation !== activation ||
          !definition.exposure![entry] ||
          !definition.platforms!.includes(context.platform) ||
          !definition.views!.includes(context.view)
        )
          return false;
        if (["document", "selection"].includes(definition.scope)) {
          if (!context.documentId || !this.sessions.active(context.documentId))
            return false;
          if (
            !permissions.includes(
              definition.risk === "read"
                ? "documents.current.read"
                : "editor.selection.write",
            )
          )
            return false;
        }
        return true;
      })
      .map(({ definition }) => ({
        id: definition.id,
        scope: definition.scope,
        risk: definition.risk,
      }));
    const methods = [
      "capabilities.query",
      "commands.execute",
      "requests.cancel",
    ];
    if (["render", "source"].includes(context.view)) {
      if (permissions.includes("editor.selection.read"))
        methods.push("editor.captureSelection");
      if (permissions.includes("editor.selection.write"))
        methods.push("editor.insert", "editor.insertAtSelection");
    }
    if (permissions.includes("documents.current.read"))
      methods.push(
        "documents.whenSaved",
        "documents.snapshot",
        "events.subscribe",
        "events.read",
        "events.unsubscribe",
      );
    return {
      protocol: 1 as const,
      platform: context.platform,
      view: context.view,
      permissions,
      commands,
      methods,
    };
  }

  private currentEditor() {
    const context = this.context();
    if (!["render", "source"].includes(context.view))
      throw new PluginHostError("UNSUPPORTED_VIEW", "当前视图不支持编辑目标");
    if (!context.documentId || !this.sessions.active(context.documentId))
      throw new PluginHostError("STALE_TARGET", "没有活动文档");
    return context.documentId;
  }
  captureSelection(activation: PluginActivation) {
    this.runtime.assert(activation, "editor.selection.read");
    return this.intents.captureSelection(activation, this.currentEditor());
  }
  insertTarget(
    activation: PluginActivation,
    target: DocumentEditTarget,
    content: InsertDocumentContent,
    signal?: AbortSignal,
    accepted?: () => void,
  ) {
    this.runtime.assert(activation, "editor.selection.write");
    if (this.currentEditor() !== target.documentId)
      throw new PluginHostError("STALE_TARGET", "活动文档已变化");
    return this.intents.insert(activation, target, content, signal, accepted);
  }
  insertAtSelection(
    activation: PluginActivation,
    content: InsertDocumentContent,
    signal?: AbortSignal,
    accepted?: () => void,
  ) {
    this.runtime.assert(activation, "editor.selection.write");
    let target: DocumentEditTarget;
    try {
      target = this.sessions.capture(this.currentEditor());
    } catch (error) {
      if (error instanceof PluginHostError) throw error;
      throw new PluginHostError("STALE_TARGET", "当前选区不可用");
    }
    return this.insertTarget(activation, target, content, signal, accepted);
  }
  async whenSaved(
    activation: PluginActivation,
    revision: DocumentSaveRevision,
    signal?: AbortSignal,
  ) {
    this.runtime.assert(activation, "documents.current.read");
    try {
      await this.sessions.whenSaved(revision.documentId, revision, signal);
      this.runtime.assert(activation, "documents.current.read");
    } catch (error) {
      if (error instanceof PluginHostError) throw error;
      if (error instanceof SaveBarrierError)
        throw new PluginHostError(
          error.code,
          error.code === "STALE_REVISION"
            ? "文档已换代，保存确认失效"
            : error.code === "CANCELLED"
              ? "保存等待已取消"
              : "文档保存失败，请显式重试",
        );
      throw new PluginHostError("SAVE_FAILED", "文档保存失败，请显式重试");
    }
  }

  async snapshot(
    activation: PluginActivation,
    signal?: AbortSignal,
    metadataOnly = false,
    captured?: (documentId: string) => void,
  ) {
    this.runtime.assert(activation, "documents.current.read");
    const context = this.context();
    if (!["render", "source", "readonly"].includes(context.view))
      throw new PluginHostError(
        "UNSUPPORTED_VIEW",
        "当前视图没有 Markdown 正文",
      );
    const id = context.documentId;
    if (!id) throw new PluginHostError("STALE_TARGET", "没有活动文档");
    let revision: DocumentSaveRevision;
    try {
      revision = this.sessions.readRevision(id);
    } catch {
      throw new PluginHostError("STALE_TARGET", "文档状态已失效");
    }
    const check = () => {
      this.runtime.assert(activation, "documents.current.read");
      if (signal?.aborted) throw new PluginHostError("CANCELLED", "读取已取消");
      const current = this.context();
      try {
        const next = this.sessions.readRevision(id);
        if (
          current.documentId !== id ||
          current.view !== context.view ||
          next.documentGeneration !== revision.documentGeneration ||
          next.contentRevision !== revision.contentRevision
        )
          throw new Error();
      } catch {
        throw new PluginHostError("STALE_TARGET", "读取期间文档已变化");
      }
    };
    try {
      return await withProtectionWrite(async () => {
        check();
        // Freeze before storage reads: an in-flight save may finish and clear pending.
        const pending = metadataOnly
          ? null
          : structuredClone(this.sessions.pendingChanges(id));
        const note = await api.notes.get(id);
        check();
        if (!note) throw new PluginHostError("STALE_TARGET", "文档已不存在");
        const paths = await listProtectedPaths();
        check();
        if (
          isEncrypted(note.content) ||
          paths.some((item) =>
            isPathUnder(
              normalizeStoragePath(note.storagePath || "references"),
              item.path,
            ),
          )
        )
          throw new PluginHostError(
            "PERMISSION_DENIED",
            "首期插件不开放受保护正文读取",
          );
        const value = structuredClone({
          documentId: id,
          title: pending?.title ?? note.title ?? "",
          content: metadataOnly ? null : (pending?.content ?? note.content),
        });
        check();
        captured?.(id);
        return { value, revision };
      });
    } catch (error) {
      if (error instanceof PluginHostError) throw error;
      if (error instanceof SaveBarrierError)
        throw new PluginHostError(
          error.code === "STALE_REVISION" ? "STALE_TARGET" : error.code,
          "读取未完成",
        );
      throw new PluginHostError("INTERNAL_ERROR", "读取未完成");
    }
  }

  subscribeRevisions(
    listener: Parameters<DocumentEditSessions["subscribeRevisions"]>[0],
  ) {
    return this.sessions.subscribeRevisions(listener);
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
    return this.runtime.own(activation, () => {
      if (this.commands.get(declaration.id) === command)
        this.commands.delete(declaration.id);
    });
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
