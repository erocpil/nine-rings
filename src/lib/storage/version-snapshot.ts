/** Compare all fields carried by a version, across JSON/SQLite representations. */
export function sameVersionSnapshot(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const json = (value: unknown, fallback: unknown) => JSON.stringify(
    typeof value === "string" ? JSON.parse(value) : value ?? fallback,
  );
  const pinned = (value: unknown) => value === true || value === 1 || value === "1";
  return (a.title ?? "") === (b.title ?? "")
    && json(a.content, {}) === json(b.content, {})
    && json(a.tags, []) === json(b.tags, [])
    && pinned(a.pinned) === pinned(b.pinned)
    && (a.sort_order ?? 0) === (b.sort_order ?? 0);
}
