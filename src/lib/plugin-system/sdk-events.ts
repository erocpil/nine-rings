import type { DocumentViewEvent } from "../document-edit-sessions";
import type { DocumentRevisionEvent } from "../document-save-revisions";
import type { SdkEditorHandles } from "./sdk-editor-handles";
import { cloneSdkValue } from "./sdk-protocol";
import type { HostCommandDispatcher } from "./command-dispatcher";
import { PluginHostError, type PluginActivation } from "./runtime";

export type SdkDocumentEvent = DocumentRevisionEvent | DocumentViewEvent;
export interface SdkEventBatch {
  events: SdkDocumentEvent[];
  resync: boolean;
}
/** Pull delivery bounds memory even when a client is suspended. No timers/body broadcasts. */
export class SdkEvents {
  private subscriptions = new Map<
    string,
    {
      documentId: string;
      events: SdkDocumentEvent[];
      resync: boolean;
      stop: () => void;
      notified: boolean;
      scheduled: boolean;
    }
  >();
  private closed = false;
  private listeners = new Set<(subscriptionId: string) => void>();
  onAvailable(listener: (subscriptionId: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  constructor(
    private dispatcher: HostCommandDispatcher,
    private activation: PluginActivation,
    private handles: SdkEditorHandles,
  ) {}
  async subscribe(signal: AbortSignal) {
    if (this.subscriptions.size >= 8)
      throw new PluginHostError("INVALID_ARGUMENT", "订阅超过连接预算");
    const subscriptionId = crypto.randomUUID();
    const state = {
      documentId: "",
      events: [] as SdkDocumentEvent[],
      resync: false,
      stop: () => {},
      notified: false,
      scheduled: false,
    };
    try {
      const { value, revision } = await this.dispatcher.snapshot(
        this.activation,
        signal,
        false,
        (documentId) => {
          state.documentId = documentId;
          if (this.closed || signal.aborted)
            throw new PluginHostError("CANCELLED", "订阅已取消");
          if (this.subscriptions.size >= 8)
            throw new PluginHostError("INVALID_ARGUMENT", "订阅超过连接预算");
          // Registered synchronously with the frozen snapshot, before another edit can run.
          const enqueue = (event: SdkDocumentEvent) => {
            if (event.documentId !== state.documentId) return;
            if (event.kind === "invalidated" || event.kind === "view")
              state.resync = true;
            const last = state.events[state.events.length - 1];
            if (
              last?.kind === event.kind &&
              (("documentGeneration" in last &&
                "documentGeneration" in event &&
                last.documentGeneration === event.documentGeneration) ||
                ("viewSession" in last &&
                  "viewSession" in event &&
                  last.viewSession === event.viewSession))
            ) {
              state.events[state.events.length - 1] = event;
              state.resync = true;
            } else {
              if (state.events.length >= 32) {
                state.events.shift();
                state.resync = true;
              }
              state.events.push(event);
            }
            if (state.notified || state.scheduled) return;
            state.scheduled = true;
            queueMicrotask(() => {
              state.scheduled = false;
              if (
                this.closed ||
                this.subscriptions.get(subscriptionId) !== state ||
                state.notified ||
                !state.events.length
              )
                return;
              state.notified = true;
              for (const listener of this.listeners) {
                try {
                  listener(subscriptionId);
                } catch {
                  /* Isolate transports. */
                }
              }
            });
          };
          const stopRevisions = this.dispatcher.subscribeRevisions(enqueue);
          const stopViews = this.dispatcher.subscribeViews(
            this.activation,
            enqueue,
          );
          state.stop = () => {
            stopRevisions();
            stopViews();
          };
          this.subscriptions.set(subscriptionId, state);
        },
      );
      state.documentId = value.documentId;
      if (this.closed || signal.aborted)
        throw new PluginHostError("CANCELLED", "订阅已取消");
      const result = {
        subscriptionId,
        snapshot: { ...value, revision: this.handles.issueRevision(revision) },
      };
      // Reserve the complete envelope overhead before retaining a subscription.
      cloneSdkValue({
        protocol: 1,
        response: {
          ok: true,
          requestId: "r".repeat(128),
          applied: false,
          value: result,
        },
      });
      return cloneSdkValue(result);
    } catch (error) {
      this.unsubscribe(subscriptionId);
      throw error;
    }
  }
  async read(id: string, signal: AbortSignal): Promise<SdkEventBatch> {
    const state = this.subscriptions.get(id);
    if (!state)
      throw new PluginHostError("INVALID_ARGUMENT", "订阅不属于此连接");
    const { value } = await this.dispatcher.snapshot(
      this.activation,
      signal,
      true,
    );
    if (this.closed || signal.aborted || this.subscriptions.get(id) !== state)
      throw new PluginHostError("CANCELLED", "订阅已取消");
    if (value.documentId !== state.documentId) {
      this.unsubscribe(id);
      throw new PluginHostError("STALE_TARGET", "活动文档已变化，请重新订阅");
    }
    const result = { events: state.events.splice(0), resync: state.resync };
    state.resync = false;
    state.notified = false;
    return result;
  }
  unsubscribe(id: string) {
    const state = this.subscriptions.get(id);
    if (!state) return;
    this.subscriptions.delete(id);
    state.stop();
    state.events.length = 0;
  }
  dispose() {
    this.closed = true;
    this.listeners.clear();
    for (const id of this.subscriptions.keys()) this.unsubscribe(id);
  }
}
