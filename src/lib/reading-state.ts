/** Device-local view state, not canonical content or a sync conflict source.
 * Heading identities may contain text: callers must exclude protected documents.
 */
export interface ReadingState {
  version: 1;
  headings?: string[];
  blocks?: {
    revision: string;
    entries: [
      number,
      { collapsed?: boolean; wrap?: boolean; lineNumbers?: boolean },
    ][];
  };
  rendered?: { scrollTop: number };
  source?: { scrollTop: number };
  virtual?: { revision: string; position: number; offset: number };
  view?: "rendered" | "source";
}
const prefix = "nr:readingState:";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export function readReadingState(noteId: string): ReadingState {
  try {
    const raw = JSON.parse(localStorage.getItem(prefix + noteId) ?? "null");
    if (!raw || raw.version !== 1) return { version: 1 };
    const state: ReadingState = { version: 1 };
    if (
      Array.isArray(raw.headings) &&
      raw.headings.every((key: unknown) => typeof key === "string")
    )
      state.headings = raw.headings;
    if (
      raw.blocks &&
      typeof raw.blocks.revision === "string" &&
      Array.isArray(raw.blocks.entries) &&
      raw.blocks.entries.every((entry: unknown) => {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          !Number.isSafeInteger(entry[0]) ||
          entry[0] < 0 ||
          !entry[1] ||
          typeof entry[1] !== "object"
        )
          return false;
        return Object.entries(entry[1]).every(
          ([key, value]) =>
            ["collapsed", "wrap", "lineNumbers"].includes(key) &&
            typeof value === "boolean",
        );
      })
    )
      state.blocks = raw.blocks;
    if (finite(raw.rendered?.scrollTop) && raw.rendered.scrollTop >= 0)
      state.rendered = { scrollTop: raw.rendered.scrollTop };
    if (finite(raw.source?.scrollTop) && raw.source.scrollTop >= 0)
      state.source = { scrollTop: raw.source.scrollTop };
    if (
      typeof raw.virtual?.revision === "string" &&
      finite(raw.virtual.position) &&
      raw.virtual.position >= 0 &&
      finite(raw.virtual.offset)
    )
      state.virtual = raw.virtual;
    if (raw.view === "rendered" || raw.view === "source") state.view = raw.view;
    return state;
  } catch {
    return { version: 1 };
  }
}
export function patchReadingState(
  noteId: string,
  patch: Partial<Omit<ReadingState, "version">>,
): void {
  try {
    localStorage.setItem(
      prefix + noteId,
      JSON.stringify({ ...readReadingState(noteId), ...patch, version: 1 }),
    );
  } catch {
    /* Storage unavailable/full: reading must remain usable. */
  }
}
export function clearReadingState(noteId: string): void {
  try {
    for (const key of [
      prefix + noteId,
      `scrollPos:${noteId}`,
      `nr:readonlyAnchor:${noteId}`,
    ])
      localStorage.removeItem(key);
  } catch {
    /* best effort */
  }
}

/** Compatibility with positions saved before the unified reading-state record. */
export function readRenderedScrollTop(noteId: string): number | null {
  const current = readReadingState(noteId).rendered?.scrollTop;
  if (current !== undefined) return current;
  try {
    const legacy = localStorage.getItem(`scrollPos:${noteId}`);
    const value = Number(legacy);
    return legacy !== null && Number.isFinite(value) && value >= 0
      ? value
      : null;
  } catch {
    return null;
  }
}
