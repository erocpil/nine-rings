/** Native IPC can reject with strings or serialized errors, not just Error instances. */
export function syncErrorMessage(reason: unknown): string {
  const seen = new Set<unknown>();
  const read = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() || null;
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    // Only known error fields: never serialize arbitrary payloads/configuration.
    for (const key of ["message", "error", "cause"] as const) {
      if (key in value) {
        const message = read((value as Record<string, unknown>)[key]);
        if (message) return message;
      }
    }
    return null;
  };
  return read(reason) ?? "未知错误（系统未返回错误详情）";
}
