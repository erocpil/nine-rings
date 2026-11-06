/** List-local navigation; never registered as application/browser shortcuts. */
export function browserNavigationIndex(key: string, current: number, count: number, pageRows: number): number | null {
  if (!count) return null;
  const at = Math.max(0, current);
  const page = Math.max(1, Math.floor(pageRows) - 1);
  const target = key === "Home" ? 0 : key === "End" ? count - 1 : key === "ArrowDown" ? current + 1 : key === "ArrowUp" ? at - 1 : key === "PageDown" ? at + page : key === "PageUp" ? at - page : null;
  return target === null ? null : Math.max(0, Math.min(count - 1, target));
}
export function browserRowScroll(top: number, height: number, index: number, rowHeight: number) {
  const rowTop = index * rowHeight, rowBottom = rowTop + rowHeight;
  return rowTop < top ? rowTop : rowBottom > top + height ? Math.max(0, rowBottom - height) : top;
}
export interface BrowserTypeahead { query: string; at: number }
export function browserTypeahead(names: readonly string[], current: number, previous: BrowserTypeahead, key: string, now: number) {
  const input = key.toLocaleLowerCase();
  const recent = previous.query && now - previous.at <= 900;
  let query = recent ? previous.query + input : input;
  const cycle = recent && [...query].every(letter => letter === input);
  if (cycle) query = input;
  const from = recent && !cycle ? Math.max(0, current) : current + 1;
  let index = -1;
  for (let offset = 0; offset < names.length; offset++) {
    const at = (from + offset + names.length) % names.length;
    if (names[at].toLocaleLowerCase().startsWith(query)) { index = at; break; }
  }
  return { query, at: now, index };
}
