/** Vim number + relativenumber: retain absolute identity, count visible units. */
export function relativeNumber(
  number: number,
  current: number,
  visible?: readonly number[],
): number {
  const distance = visible
    ? Math.abs(visibleIndex(number, visible) - visibleIndex(current, visible))
    : Math.abs(number - current);
  return distance === 0 ? number : distance;
}

function visibleIndex(number: number, visible: readonly number[]): number {
  let low = 0,
    high = visible.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (visible[middle] <= number) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export interface FoldedNumberRange {
  from: number;
  to: number;
  before: number;
}
/** Nested/adjacent folds must not subtract the same hidden logical line twice. */
export function foldedNumberRanges(
  ranges: readonly (readonly [number, number])[],
): FoldedNumberRange[] {
  const merged: FoldedNumberRange[] = [];
  for (const [from, to] of ranges) {
    if (from > to) continue;
    const previous = merged[merged.length - 1];
    if (previous && from <= previous.to + 1)
      previous.to = Math.max(previous.to, to);
    else merged.push({ from, to, before: 0 });
  }
  let count = 0;
  for (const range of merged) {
    range.before = count;
    count += range.to - range.from + 1;
  }
  return merged;
}

function lineOrdinal(
  number: number,
  ranges: readonly FoldedNumberRange[],
): number {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].from <= number) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low - 1];
  return range
    ? number - range.before - (Math.min(number, range.to) - range.from + 1)
    : number;
}

export function relativeFoldedLineNumber(
  number: number,
  current: number,
  ranges: readonly FoldedNumberRange[],
): number {
  const distance = Math.abs(
    lineOrdinal(number, ranges) - lineOrdinal(current, ranges),
  );
  return distance === 0 ? number : distance;
}
