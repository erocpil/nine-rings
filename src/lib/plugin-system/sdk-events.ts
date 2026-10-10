import type { DocumentRevisionEvent } from "../document-save-revisions";
import type { HostCommandDispatcher } from "./command-dispatcher";
import { PluginHostError, type PluginActivation } from "./runtime";

export interface SdkEventBatch {
  events: DocumentRevisionEvent[];
  resync: boolean;
}
/** Pull delivery bounds memory even when a client is suspended. No timers/body broadcasts. */
export class SdkEvents {
  private subscriptions = new Map<
    string,
    {
      documentId: string;
      events: DocumentRevisionEvent[];
      resync: boolean;
      stop: () => void;
    }
  >();
  private closed = false;
  constructor(
    private dispatcher: HostCommandDispatcher,
    private activation: PluginActivation,
  ) {}
  async subscribe(signal: AbortSignal) {
    if (this.subscriptions.size >= 8)
      throw new PluginHostError("INVALID_ARGUMENT", "订阅超过连接预算");
    const { value } = await this.dispatcher.snapshot(
      this.activation,
      signal,
      true,
    );
    if (this.closed || signal.aborted)
      throw new PluginHostError("CANCELLED", "订阅已取消");
    // Recheck after async authorization: concurrent subscriptions share the same budget.
    if (this.subscriptions.size >= 8)
      throw new PluginHostError("INVALID_ARGUMENT", "订阅超过连接预算");
    const subscriptionId = crypto.randomUUID();
    const state = {
      documentId: value.documentId,
      events: [] as DocumentRevisionEvent[],
      resync: false,
      stop: () => {},
    };
    state.stop = this.dispatcher.subscribeRevisions((event) => {
      if (event.documentId !== state.documentId) return;
      if (event.kind === "invalidated") state.resync = true;
      const last = state.events[state.events.length - 1];
      if (
        last?.kind === event.kind &&
        last.documentGeneration === event.documentGeneration
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
    });
    this.subscriptions.set(subscriptionId, state);
    return { subscriptionId };
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
    for (const id of this.subscriptions.keys()) this.unsubscribe(id);
  }
}
