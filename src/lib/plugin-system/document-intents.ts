import type {
  DocumentEditSessions,
  DocumentEditTarget,
  InsertDocumentContent,
} from "../document-edit-sessions";
import { StaleEditTargetError } from "../document-edit-sessions";
import { isEncrypted } from "../document-crypto";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import {
  listProtectedPaths,
  withProtectionWrite,
} from "../storage/protection-state";
import { api } from "../api";
import {
  PluginHostError,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";

/** First host surface edits the active session only. No raw storage/SQL, arbitrary
 * document patch or unlocked protected-body capability is exposed. */
export class DocumentIntentService {
  constructor(
    private runtime: PluginRuntime,
    private sessions: DocumentEditSessions,
  ) {}
  captureSelection(
    activation: PluginActivation,
    id: string,
  ): DocumentEditTarget {
    this.runtime.assert(activation, "editor.selection.read");
    try {
      return this.sessions.capture(id);
    } catch {
      throw new PluginHostError("STALE_TARGET", "当前编辑选区不可用");
    }
  }
  async insert(
    activation: PluginActivation,
    target: DocumentEditTarget,
    content: InsertDocumentContent,
    signal?: AbortSignal,
    accepted?: () => void,
  ) {
    const check = () => {
      this.runtime.assert(activation, "editor.selection.write");
      if (signal?.aborted) throw new PluginHostError("CANCELLED", "命令已取消");
      try {
        this.sessions.validate(target);
      } catch {
        throw new PluginHostError("STALE_TARGET", "编辑目标已变化");
      }
    };
    check();
    if (
      !content ||
      !["text", "markdown"].includes(content.type) ||
      typeof content.value !== "string" ||
      content.value.length > 100000
    )
      throw new PluginHostError("INVALID_ARGUMENT", "插入内容无效或超出限制");
    const input = Object.freeze({ type: content.type, value: content.value });
    // Permission, active view and selection are checked again after every await.
    return withProtectionWrite(async () => {
      const note = await api.notes.get(target.documentId);
      check();
      if (!note) throw new PluginHostError("STALE_TARGET", "文档已不存在");
      if (note.readonly) throw new PluginHostError("READ_ONLY", "文档为只读");
      if (isEncrypted(note.content))
        throw new PluginHostError(
          "PERMISSION_DENIED",
          "首期插件不开放受保护正文写入",
        );
      const path = normalizeStoragePath(note.storagePath || "references");
      const paths = await listProtectedPaths();
      check();
      if (paths.some((item) => isPathUnder(path, item.path)))
        throw new PluginHostError(
          "PERMISSION_DENIED",
          "首期插件不开放受保护路径写入",
        );
      try {
        const revision = this.sessions.apply(target, input);
        accepted?.();
        return revision;
      } catch (error) {
        if (error instanceof StaleEditTargetError)
          throw new PluginHostError("STALE_TARGET", "编辑目标已变化");
        if (error instanceof Error && error.message === "READ_ONLY")
          throw new PluginHostError("READ_ONLY", "编辑视图不可写入");
        throw new PluginHostError("INTERNAL_ERROR", "编辑操作未完成");
      }
    });
  }
}
