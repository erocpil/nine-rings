import { useMemo, useRef, useState } from "react";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { diffDocumentLines, type DiffLine } from "../lib/document-diff";
import type { SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";
import { DocumentContentPreview } from "./DocumentContentPreview";

interface DiffRow { kind: "same" | "changed"; same?: DiffLine[]; left?: DiffLine; right?: DiffLine; }

function makeRows(lines: DiffLine[], showUnchanged: boolean): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    if (lines[index].kind === "same") {
      const same: DiffLine[] = [];
      while (index < lines.length && lines[index].kind === "same") same.push(lines[index++]);
      if (showUnchanged) same.forEach(line => rows.push({ kind: "same", same: [line] }));
      else rows.push({ kind: "same", same });
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

function DiffLineView({ line }: { line?: DiffLine }) {
  if (!line) return <div className="document-diff-line empty"><span className="document-diff-number"> </span><code>&nbsp;</code></div>;
  return <div className={`document-diff-line ${line.kind}`}>
    <span className="document-diff-number">{line.left ?? line.right ?? ""}</span><code>{line.text || "\u00a0"}</code>
  </div>;
}

export function DocumentComparison({ left, right, leftLabel = "左侧", rightLabel = "右侧" }: {
  left: SyncRemoteDocumentPreview; right: SyncRemoteDocumentPreview; leftLabel?: string; rightLabel?: string;
}) {
  const [mode, setMode] = useState("text");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const unavailable = (left.encrypted || right.encrypted) && mode !== "properties";
  const diff = useMemo(() => {
    if (unavailable) return null;
    const source = (doc: SyncRemoteDocumentPreview) => mode === "properties" ? doc.properties
      : mode === "structure" ? JSON.stringify(doc.content, null, 2) : deltaToMarkdown(doc.content);
    return diffDocumentLines(source(left), source(right));
  }, [left, right, mode, unavailable]);
  const rows = useMemo(() => makeRows(diff?.lines ?? [], showUnchanged), [diff, showUnchanged]);
  const changed = diff?.lines.filter(line => line.kind !== "same").length ?? 0;
  const leftScroll = useRef<HTMLDivElement>(null);
  const rightScroll = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const syncScroll = (source: "left" | "right") => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === "left" ? leftScroll.current : rightScroll.current;
    const to = source === "left" ? rightScroll.current : leftScroll.current;
    if (from && to) { to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft; }
    requestAnimationFrame(() => { syncing.current = false; });
  };
  return <div className="document-comparison">
    <div className="document-compare-controls">
      <label>差异视图 <select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="text">正文（Markdown）</option><option value="structure">排版与正文结构</option><option value="properties">标题、路径与属性</option>
      </select></label>
      <label><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />显示相同行</label>
    </div>
    {unavailable ? <p>含加密正文，不能比较正文差异；仍可查看标题、路径与属性。</p> : <>
      <p role="status">{changed ? `${diff?.lines.filter(line => line.kind === "removed").length} 行移除 / ${diff?.lines.filter(line => line.kind === "added").length} 行新增` : "此视图内容相同"}。相同行已折叠。</p>
      {diff?.coarse && <p>变更范围较大，变更区域按整段移除／新增展示，内容未省略。</p>}
      <div className="document-diff-header"><span>{leftLabel}</span><span>{rightLabel}</span></div>
      <div className="document-diff-columns" aria-label="逐行差异">
        <div ref={leftScroll} className="document-diff-scroll-pane" onScroll={() => syncScroll("left")}>
          {rows.map((row, index) => row.kind === "same" && row.same && row.same.length > 1
            ? <button type="button" className="document-diff-collapsed" key={`left-${index}`} onClick={() => setShowUnchanged(true)}>⋯ {row.same.length} 行相同</button>
            : <DiffLineView key={`left-${index}`} line={row.kind === "same" ? row.same?.[0] : row.left} />)}
        </div>
        <div ref={rightScroll} className="document-diff-scroll-pane" onScroll={() => syncScroll("right")}>
          {rows.map((row, index) => row.kind === "same" && row.same && row.same.length > 1
            ? <button type="button" className="document-diff-collapsed" key={`right-${index}`} onClick={() => setShowUnchanged(true)}>⋯ {row.same.length} 行相同</button>
            : <DiffLineView key={`right-${index}`} line={row.kind === "same" ? row.same?.[0] : row.right} />)}
        </div>
      </div>
    </>}
    <div className="document-comparison-previews">
      {[{ doc: left, label: leftLabel }, { doc: right, label: rightLabel }].map(({ doc, label }) => <section key={label}>
        <h4>{label}：{doc.title}</h4><small>{doc.storagePath || doc.date || "无路径"} · {doc.updatedAt || "无修改时间"}</small>
        <div className="document-comparison-preview"><DocumentContentPreview key={doc.id + doc.updatedAt} content={doc.content} encrypted={doc.encrypted} /></div>
      </section>)}
    </div>
  </div>;
}
