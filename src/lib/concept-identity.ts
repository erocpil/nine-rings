/** Search equivalence only; persisted display values are never rewritten implicitly. */
export function conceptSearchKey(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

/** Explicit literal source names, not every label sharing a search key. */
export function mergedConcepts(values: string[], sources: string[], target: string): string[] {
  const destination = target.trim();
  if (!destination) throw new Error("目标概念不能为空");
  const sourceSet = new Set(sources);
  if (!values.some(value => sourceSet.has(value))) return [...values];
  return [...new Set(values.map(value => sourceSet.has(value) ? destination : value))];
}
