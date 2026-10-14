/** Local UI state only: document identity, fingerprint and layout; never document text. */
const KEY = "nr:vocabularyReading";
const SORT_KEY = "nr:vocabularySort";
export interface VocabularyReadingState {
  fingerprint: string;
  scrollTop: number;
  folds: Record<string, boolean>;
  touched: number;
}
export function vocabularyFingerprint(source: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ source.charCodeAt(i);
  }
  return `${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
function states(): Record<string, VocabularyReadingState> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return Object.create(null);
    const result: Record<string, VocabularyReadingState> = Object.create(null);
    for (const [id, item] of Object.entries(parsed)) {
      if (!item || typeof item !== "object" || id.length > 128) continue;
      const value = item as VocabularyReadingState;
      if (
        typeof value.fingerprint !== "string" ||
        value.fingerprint.length > 64 ||
        !Number.isFinite(value.scrollTop) ||
        value.scrollTop < 0 ||
        !Number.isFinite(value.touched) ||
        !value.folds ||
        typeof value.folds !== "object" ||
        Array.isArray(value.folds)
      )
        continue;
      result[id] = {
        fingerprint: value.fingerprint,
        scrollTop: Math.min(value.scrollTop, 10_000_000),
        touched: value.touched,
        folds: Object.fromEntries(
          Object.entries(value.folds)
            .filter(
              ([key, open]) =>
                /^[a-z0-9:/.-]{1,96}$/.test(key) && typeof open === "boolean",
            )
            .slice(0, 512),
        ),
      };
    }
    return result;
  } catch {
    return Object.create(null);
  }
}
export function readVocabularyReading(
  id: string,
  source: string,
): VocabularyReadingState {
  const fingerprint = vocabularyFingerprint(source),
    previous = states()[id];
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, scrollTop: 0, folds: {}, touched: 0 };
}
export function saveVocabularyReading(
  id: string,
  value: VocabularyReadingState,
) {
  try {
    const all = states();
    all[id] = {
      ...value,
      scrollTop: Math.min(10_000_000, Math.max(0, value.scrollTop)),
      folds: Object.fromEntries(
        Object.entries(value.folds)
          .filter(
            ([key, open]) =>
              /^[a-z0-9:/.-]{1,96}$/.test(key) && typeof open === "boolean",
          )
          .slice(0, 512),
      ),
      touched: Math.max(
        Date.now(),
        ...Object.values(all).map((item) => item.touched + 1),
      ),
    };
    const limited = Object.fromEntries(
      Object.entries(all)
        .sort((a, b) => b[1].touched - a[1].touched)
        .slice(0, 50),
    );
    localStorage.setItem(KEY, JSON.stringify(limited));
  } catch {
    /* Quota/private storage must not prevent reading. */
  }
}
export type VocabularySort = "alphabet" | "added";
export function readVocabularySort(): VocabularySort {
  try {
    return localStorage.getItem(SORT_KEY) === "added" ? "added" : "alphabet";
  } catch {
    return "alphabet";
  }
}
export function saveVocabularySort(value: VocabularySort) {
  try {
    localStorage.setItem(SORT_KEY, value);
  } catch {
    /* UI remains usable. */
  }
}
const collator = new Intl.Collator("en", { sensitivity: "base" });
export function sortVocabulary<
  T extends { id: string; title: string | null; created_at: string },
>(items: readonly T[], order: VocabularySort): T[] {
  return [...items].sort(
    (a, b) =>
      (order === "added"
        ? (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
        : 0) ||
      collator.compare(a.title ?? "", b.title ?? "") ||
      a.id.localeCompare(b.id),
  );
}
