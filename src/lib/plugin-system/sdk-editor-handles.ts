import type {
  DocumentEditTarget,
  InsertDocumentContent,
} from "../document-edit-sessions";
import type { DocumentSaveRevision } from "../document-save-revisions";
import type { HostCommandDispatcher } from "./command-dispatcher";
import { PluginHostError, type PluginActivation } from "./runtime";

export interface SdkEditTarget {
  token: string;
}
export interface SdkEditResult {
  documentId: string;
  revision: string;
}
export interface SdkInsertContent {
  format: "text" | "markdown";
  value: string;
}
const HANDLE_LIMIT = 256;
const TARGET_TTL = 5 * 60000;

/** Opaque, connection-local handles. Descriptors never reconstruct host authority. */
export class SdkEditorHandles {
  private closed = false;
  private targets = new Map<
    string,
    { target: DocumentEditTarget; expires: number }
  >();
  private revisions = new Map<string, DocumentSaveRevision>();
  constructor(
    private dispatcher: HostCommandDispatcher,
    private activation: PluginActivation,
  ) {}
  capture(): SdkEditTarget {
    const target = this.dispatcher.captureSelection(this.activation);
    const token = crypto.randomUUID();
    this.bound(this.targets);
    this.targets.set(token, { target, expires: Date.now() + TARGET_TTL });
    return { token };
  }
  async insert(
    token: string | undefined,
    content: SdkInsertContent,
    signal: AbortSignal,
    accepted: () => void,
  ): Promise<SdkEditResult> {
    const input: InsertDocumentContent = {
      type: content.format,
      value: content.value,
    };
    let revision: DocumentSaveRevision;
    if (token === undefined)
      revision = await this.dispatcher.insertAtSelection(
        this.activation,
        input,
        signal,
        accepted,
      );
    else {
      const handle = this.targets.get(token);
      if (!handle || handle.expires < Date.now())
        throw new PluginHostError(
          "STALE_TARGET",
          "编辑目标已过期或不属于此连接",
        );
      // Consume before awaiting: concurrent requests cannot reuse a target.
      this.targets.delete(token);
      revision = await this.dispatcher.insertTarget(
        this.activation,
        handle.target,
        input,
        signal,
        accepted,
      );
    }
    if (this.closed || signal.aborted)
      throw new PluginHostError("CANCELLED", "编辑结果已失效");
    const savedToken = crypto.randomUUID();
    this.bound(this.revisions);
    this.revisions.set(savedToken, revision);
    return { documentId: revision.documentId, revision: savedToken };
  }
  async whenSaved(
    documentId: string,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    const revision = this.revisions.get(token);
    if (!revision || revision.documentId !== documentId)
      throw new PluginHostError("STALE_REVISION", "保存修订不属于此连接或文档");
    await this.dispatcher.whenSaved(this.activation, revision, signal);
  }
  clear() {
    this.closed = true;
    this.targets.clear();
    this.revisions.clear();
  }
  private bound<T>(map: Map<string, T>) {
    if (map.size >= HANDLE_LIMIT) map.delete(map.keys().next().value!);
  }
}
