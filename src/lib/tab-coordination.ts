import { isTauriRuntime } from "./runtime";

export interface DataChangeEvent {
  type: "note-changed" | "note-deleted" | "data-imported";
  noteId?: string;
  at: string;
}

const CHANNEL_NAME = "nine-rings:data-changes:v1";
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" && !isTauriRuntime()
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;
  return channel;
}

export function broadcastDataChange(event: Omit<DataChangeEvent, "at">): void {
  getChannel()?.postMessage({ ...event, at: new Date().toISOString() } satisfies DataChangeEvent);
}

export function subscribeToDataChanges(listener: (event: DataChangeEvent) => void): () => void {
  const target = getChannel();
  if (!target) return () => {};
  const handleMessage = (message: MessageEvent<DataChangeEvent>) => listener(message.data);
  target.addEventListener("message", handleMessage);
  return () => target.removeEventListener("message", handleMessage);
}
