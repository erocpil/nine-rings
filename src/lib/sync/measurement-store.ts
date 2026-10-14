/** Session-only aggregate diagnostics; never retain URLs, credentials or payloads. */
export interface TransferMeasurement {
  kind: "snapshot" | "pointer" | "blob" | "git-metadata";
  transport: "native" | "web";
  requestBytes: number;
  durationMs: number;
  status: number | null;
  outcome: "response" | "transport-error";
}
let snapshot: readonly TransferMeasurement[] = [];
const listeners = new Set<() => void>();
export const transferMeasurements = () => snapshot;
export function subscribeTransfers(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearTransferMeasurements() {
  snapshot = [];
  listeners.forEach((listener) => listener());
}
export async function measureTransfer(
  input: Pick<TransferMeasurement, "kind" | "transport" | "requestBytes">,
  request: () => Promise<Response>,
): Promise<Response> {
  const start = performance.now();
  let status: number | null = null;
  try {
    const response = await request();
    status = response.status;
    return response;
  } finally {
    const entry: TransferMeasurement = {
      kind: ["snapshot", "pointer", "blob", "git-metadata"].includes(input.kind)
        ? input.kind
        : "git-metadata",
      transport: input.transport === "native" ? "native" : "web",
      requestBytes:
        Number.isSafeInteger(input.requestBytes) && input.requestBytes >= 0
          ? input.requestBytes
          : 0,
      status,
      durationMs: performance.now() - start,
      outcome: status === null ? "transport-error" : "response",
    };
    snapshot = [...snapshot, entry].slice(-24);
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* Diagnostics must not affect writes. */
      }
    });
  }
}
