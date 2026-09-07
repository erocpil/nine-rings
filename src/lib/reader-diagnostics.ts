type ReaderEvent =
  "boot" | "open" | "close-request" | "render-error" | "pagehide";
interface ReaderDiagnostic {
  event: ReaderEvent;
  at: number;
}
const KEY = "nr:reader-diagnostics:v1";
const events = new Set<ReaderEvent>([
  "boot",
  "open",
  "close-request",
  "render-error",
  "pagehide",
]);

/** Bounded metadata only: no document IDs, names, content or error messages. */
export function readReaderDiagnostics(): ReaderDiagnostic[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is ReaderDiagnostic =>
          typeof item === "object" &&
          item !== null &&
          events.has(item.event) &&
          typeof item.at === "number" &&
          Number.isFinite(item.at),
      )
      .slice(-40)
      .map(({ event, at }) => ({ event, at }));
  } catch {
    return [];
  }
}

export function recordReaderDiagnostic(event: ReaderEvent): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        [...readReaderDiagnostics(), { event, at: Date.now() }].slice(-40),
      ),
    );
  } catch {
    /* Diagnostics must never interrupt reading, including quota errors. */
  }
}
