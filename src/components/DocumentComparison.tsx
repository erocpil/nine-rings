import { useMemo, useState } from "react";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { diffDocumentLines } from "../lib/document-diff";
import type { SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";
import { DocumentContentPreview } from "./DocumentContentPreview";

export function DocumentComparison({ left, right, leftLabel = "左侧", rightLabel = "右侧" }: {
  left: SyncRemoteDocumentPreview; right: SyncRemoteDocumentPreview; leftLabel?: string; rightLabel?: string;
}) {
  const [mode, setMode] = useState("text");
  const [limit, setLimit] = useState(300);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const unavailable = (left.encrypted || right.encrypted) && mode !== "properties";
  const diff = useMemo(() => {
    if (unavailable) return null;
    const source = (doc: SyncRemoteDocumentPreview) => mode === "properties" ? doc.properties
      : mode === "structure" ? JSON.stringify(doc.content, null, 2) : deltaToMarkdown(doc.content);
    return diffDocumentLines(source(left), source(right));
  }, [left, right, mode, unavailable]);
  const changed = diff?.lines.filter(line => line.kind !== "same").length ?? 0;
  const visibleLines = useMemo(() => diff?.lines.filter(line => showUnchanged || line.kind !== "same") ?? [], [diff, showUnchanged]);
  return <div className="document-comparison">
    <div className="document-comparison-panes">
      {[{ doc: left, label: leftLabel }, { doc: right, label: rightLabel }].map(({ doc, label }) => <section key={label}>
        <h4>{label}：{doc.title}</h4>
        <small>{doc.storagePath || doc.date || "无路径"} · {doc.updatedAt || "无修改时间"}</small>
        <div className="document-comparison-preview"><DocumentContentPreview key={doc.id + doc.updatedAt} content={doc.content} encrypted={doc.encrypted} /></div>
      </section>)}
    </div>
    <label>差异视图 <select value={mode} onChange={event => { setMode(event.target.value); setLimit(300); }}>
      <option value="text">正文（Markdown）</option><option value="structure">排版与正文结构</option><option value="properties">标题、路径与属性</option>
    </select></label>
    {unavailable ? <p>含加密正文，不能比较正文差异；仍可查看标题、路径与属性。</p> : <>
      <p role="status">{changed ? `${diff?.lines.filter(line => line.kind === "removed").length} 行移除 / ${diff?.lines.filter(line => line.kind === "added").length} 行新增` : "此视图内容相同"}。− 表示{leftLabel}，+ 表示{rightLabel}。</p>
      <label><input type="checkbox" checked={showUnchanged} onChange={event => { setShowUnchanged(event.target.checked); setLimit(300); }} />显示相同行</label>
      {mode === "text" && !changed && left.revision !== right.revision && <p>正文 Markdown 相同，排版或属性可能不同，请查看另外两个差异视图。</p>}
      {diff?.coarse && <p>变更范围较大，变更区域按整段移除／新增展示，内容未省略。</p>}
      <div className="document-diff-lines" aria-label="逐行差异">
        {visibleLines.slice(0, limit).map((line, index) => <div key={index} className={`document-diff-line ${line.kind}`}>
          <span className="document-diff-number">{line.left ?? ""}</span><span className="document-diff-number">{line.right ?? ""}</span>
          <span>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span><code>{line.text || "\u00a0"}</code>
        </div>)}
      </div>
      {visibleLines.length > limit && <button type="button" className="settings-btn" onClick={() => setLimit(limit + 300)}>继续显示差异（剩余 {visibleLines.length - limit} 行）</button>}
    </>}
  </div>;
}
