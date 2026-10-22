import { useMemo, useState } from "react";
import { deltaToMarkdown } from "../lib/markdown-serializer";
import { TextDiffView } from "./TextDiffView";
import type { SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";
import { DocumentContentPreview } from "./DocumentContentPreview";

export function DocumentComparison({ left, right, leftLabel = "左侧", rightLabel = "右侧" }: {
  left: SyncRemoteDocumentPreview; right: SyncRemoteDocumentPreview; leftLabel?: string; rightLabel?: string;
}) {
  const [mode, setMode] = useState("text");
  const unavailable = (left.encrypted || right.encrypted) && mode !== "properties";
  const sources = useMemo(() => {
    if (unavailable) return null;
    const source = (doc: SyncRemoteDocumentPreview) => mode === "properties" ? doc.properties
      : mode === "structure" ? JSON.stringify(doc.content, null, 2) : deltaToMarkdown(doc.content);
    return [source(left), source(right)];
  }, [left, right, mode, unavailable]);
  const modeControl = <label>差异视图 <select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="text">正文（Markdown）</option><option value="structure">排版与正文结构</option><option value="properties">标题、路径与属性</option>
      </select></label>;
  return <div className="document-comparison">
    {unavailable ? <><div className="document-compare-controls">{modeControl}</div><p>含加密正文，不能比较正文差异；仍可查看标题、路径与属性。</p></> : sources &&
      <TextDiffView left={sources[0]} right={sources[1]} leftLabel={leftLabel} rightLabel={rightLabel} controls={modeControl} />}
    <div className="document-comparison-previews">
      {[{ doc: left, label: leftLabel }, { doc: right, label: rightLabel }].map(({ doc, label }) => <section key={label}>
        <h4>{label}：{doc.title}</h4><small>{doc.storagePath || doc.date || "无路径"} · {doc.updatedAt || "无修改时间"}</small>
        <div className="document-comparison-preview"><DocumentContentPreview key={doc.id + doc.updatedAt} content={doc.content} encrypted={doc.encrypted} /></div>
      </section>)}
    </div>
  </div>;
}
