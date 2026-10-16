/** Derived plan bodies are rebuilt from raw evidence, never a durable authority. */
type DerivedBodies =
  "outgoing" | "afterPublication" | "afterLocalApply" | "equal";
export function entityPlanSummary<T extends object>(
  value: T,
): Omit<T, DerivedBodies> {
  const summary = { ...value } as T & {
    outgoing?: unknown;
    afterPublication?: unknown;
    afterLocalApply?: unknown;
    equal?: unknown;
  };
  delete summary.outgoing;
  delete summary.afterPublication;
  delete summary.afterLocalApply;
  delete summary.equal;
  return summary;
}
/** Snapshot mutable metadata synchronously; large primitive strings are immutable
 * and can be shared instead of copied by structuredClone at every validation layer. */
export function snapshotEntityReview<
  T extends { localSource: string; remoteSource: string },
>(value: T): Omit<T, DerivedBodies> {
  const { localSource, remoteSource, ...metadata } = entityPlanSummary(value);
  if (typeof localSource !== "string" || typeof remoteSource !== "string")
    throw Error("审查原始来源无效");
  return { ...structuredClone(metadata), localSource, remoteSource } as Omit<
    T,
    DerivedBodies
  >;
}
