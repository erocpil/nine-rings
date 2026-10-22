import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { diffDocumentLines, type DiffLine } from "../lib/document-diff";

interface DiffRow { kind: "same" | "changed"; same?: DiffLine[]; left?: DiffLine; right?: DiffLine }
function makeRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].kind === "same") {
      const same: DiffLine[] = [];
      while (index < lines.length && lines[index].kind === "same") same.push(lines[index++]);
      rows.push({ kind: "same", same });
      continue;
    }
    const changed: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== "same") changed.push(lines[index++]);
    const removed = changed.filter(line => line.kind === "removed");
    const added = changed.filter(line => line.kind === "added");
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) rows.push({ kind: "changed", left: removed[offset], right: added[offset] });
  }
  return rows;
}
function DiffLineView({ line, side, showWhitespace = false }: { line?: DiffLine; side: "left" | "right"; showWhitespace?: boolean }) {
  if (!line) return <div className="document-diff-line empty"><span className="document-diff-number"> </span><code>&nbsp;</code></div>;
  return <div className={`document-diff-line ${line.kind}`}><span className="document-diff-number">{line[side] ?? ""}</span><code data-whitespace-visible={showWhitespace || undefined}>{showWhitespace ? Array.from(line.text, (character, index) => character === " "
    ? <span className="diff-whitespace-space" key={index}>{character}</span>
    : character === "\t" ? <span className="diff-whitespace-tab" key={index}>{character}</span> : character) : line.text || "\u00a0"}</code></div>;
}

/** Shared raw-text diff: never serializes code through Markdown. */
export function TextDiffView({ left, right, leftLabel, rightLabel, showWhitespace, controls }: {
  left: string; right: string; leftLabel: string; rightLabel: string;
  showWhitespace?: boolean; controls?: ReactNode;
}) {
  const diff = useMemo(() => diffDocumentLines(left, right), [left, right]);
  const rows = useMemo(() => makeRows(diff.lines), [diff]);
  const [expansion, setExpansion] = useState({ diff, groups: new Set<number>() });
  // Expansion belongs to this comparison, never a previously viewed document.
  const expanded = expansion.diff === diff ? expansion.groups : new Set<number>();
  useEffect(() => {
    setExpansion(previous => previous.diff === diff ? previous : { diff, groups: new Set<number>() });
  }, [diff]);
  const foldable = rows.flatMap((row, index) => row.same && row.same.length > 1 ? [index] : []);
  const expandedCount = foldable.filter(index => expanded.has(index)).length;
  const allExpanded = foldable.length > 0 && expandedCount === foldable.length;
  const removed = diff.lines.filter(line => line.kind === "removed").length;
  const added = diff.lines.filter(line => line.kind === "added").length;
  const leftScroll = useRef<HTMLDivElement>(null);
  const rightScroll = useRef<HTMLDivElement>(null);
  const mirrored = useRef(new WeakMap<HTMLElement, { top: number; left: number }>());
  const pendingScroll = useRef<{ pane: HTMLDivElement; anchor: string; offset: number; left: number; focus: boolean }[]>([]);
  const changeExpansion = (groups: Set<number>, index?: number) => {
    pendingScroll.current = [leftScroll.current, rightScroll.current].flatMap(pane => {
      if (!pane) return [];
      const top = pane.getBoundingClientRect().top + pane.clientTop;
      const anchor = index !== undefined ? pane.querySelector<HTMLElement>(`[data-diff-anchor="${index}"]`)
        : [...pane.querySelectorAll<HTMLElement>("[data-diff-anchor]")].find(element => element.getBoundingClientRect().bottom > top);
      return anchor ? [{ pane, anchor: anchor.dataset.diffAnchor!, offset: Math.max(0, anchor.getBoundingClientRect().top - top), left: pane.scrollLeft, focus: anchor.contains(document.activeElement) }] : [];
    });
    setExpansion({ diff, groups });
  };
  useLayoutEffect(() => {
    for (const { pane, anchor, offset, left: scrollLeft, focus } of pendingScroll.current) {
      const element = pane.querySelector<HTMLElement>(`[data-diff-anchor="${anchor}"]`);
      if (!element) continue;
      pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop - offset;
      pane.scrollLeft = scrollLeft;
      if (focus) element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      mirrored.current.set(pane, { top: pane.scrollTop, left: pane.scrollLeft });
    }
    pendingScroll.current = [];
  }, [expansion]);
  const syncScroll = (source: "left" | "right") => {
    const from = source === "left" ? leftScroll.current : rightScroll.current;
    const to = source === "left" ? rightScroll.current : leftScroll.current;
    if (!from || !to) return;
    const expected = mirrored.current.get(from);
    mirrored.current.delete(from);
    // Ignore only the event generated by our own assignment. A frame-wide lock
    // can drop the final trackpad update when both axes move in the same frame.
    if (expected && from.scrollTop === expected.top && from.scrollLeft === expected.left) return;
    if (to.scrollTop === from.scrollTop && to.scrollLeft === from.scrollLeft) return;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    mirrored.current.set(to, { top: to.scrollTop, left: to.scrollLeft });
  };
  return <>
    <div className="document-compare-controls">{controls}<label><input type="checkbox" checked={allExpanded}
      ref={element => { if (element) element.indeterminate = expandedCount > 0 && !allExpanded; }}
      disabled={!foldable.length} onChange={event => changeExpansion(new Set(event.target.checked ? foldable : []))} />显示相同行</label></div>
    <p role="status">{removed || added ? `${removed} 行移除 / ${added} 行新增` : "此视图内容相同"}。{allExpanded ? "相同行已展开。" : expandedCount ? "部分相同行已展开。" : "相同行已折叠。"}</p>
    {diff.coarse && <p>变更范围较大，变更区域按整段移除／新增展示，内容未省略。</p>}
    <div className="document-diff-header"><span>{leftLabel}</span><span>{rightLabel}</span></div>
    <div className="document-diff-columns" aria-label="逐行差异">
      {(["left", "right"] as const).map(side => <div key={side} ref={side === "left" ? leftScroll : rightScroll} className="document-diff-scroll-pane" aria-label={side === "left" ? leftLabel : rightLabel} onScroll={() => syncScroll(side)}>
        {rows.map((row, index) => <div key={index} data-diff-anchor={index} className={row.same && expanded.has(index) ? "document-diff-same-group" : undefined}>
          {row.same && row.same.length > 1 && !expanded.has(index)
            ? <button type="button" className="document-diff-collapsed" aria-label={`展开 ${row.same.length} 行相同内容`} onClick={() => changeExpansion(new Set(expanded).add(index), index)}>⋯ {row.same.length} 行相同</button>
            : row.same ? <>
              {row.same.length > 1 && <button type="button" className="document-diff-same-collapse" aria-label={`收起 ${row.same.length} 行相同内容`} title={`收起 ${row.same.length} 行相同内容`}
                onClick={() => { const next = new Set(expanded); next.delete(index); changeExpansion(next, index); }}><span aria-hidden="true">▾</span></button>}
              {row.same.map(line => <DiffLineView key={line.left} line={line} side={side} showWhitespace={showWhitespace} />)}
            </> : <DiffLineView line={row[side]} side={side} showWhitespace={showWhitespace} />}
        </div>)}
      </div>)}
    </div>
  </>;
}
