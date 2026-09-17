import { useState } from "react";
import type { PullPrecheck } from "../lib/sync/github";
import type { ConflictChoice, ConflictResolution } from "../lib/sync/backup-merge";
import { DocumentComparison } from "./DocumentComparison";

export function SyncConflictReview({ precheck, resolutions, ignoredIds, onResolve, disabled = false }: {
  precheck: PullPrecheck; resolutions: Record<string, ConflictResolution>; ignoredIds: Set<string>;
  disabled?: boolean;
  onResolve: (id: string, resolution: ConflictResolution) => void;
}) {
  const conflicts = precheck.comparison.conflicts;
  const [selected, setSelected] = useState(conflicts[0]?.id ?? "");
  if (!conflicts.length) return null;
  const left = precheck.localDocuments.find(doc => doc.id === selected);
  const right = precheck.remoteDocuments.find(doc => doc.id === selected);
  const labels: Record<ConflictChoice, string> = { both: "都保留", local: "仅保留本地", remote: "仅保留远端" };
  return <section className="sync-conflict-review" aria-label="冲突比较与处理">
    <h4>双方冲突 · {conflicts.length} 篇</h4>
    <p>默认都保留：原文档采用远端，本地版本另存为“本地同步冲突副本”。选择在点击“安全合并”后才生效。</p>
    <label>冲突文档 <select value={selected} onChange={event => setSelected(event.target.value)}>
      {conflicts.map(doc => <option key={doc.id} value={doc.id}>{doc.title} — {doc.storagePath || doc.date}（{ignoredIds.has(doc.id) ? "已忽略远端" : labels[resolutions[doc.id]?.choice ?? "both"]}）</option>)}
    </select></label>
    {left && right && <>
      <DocumentComparison key={selected} left={left} right={right} leftLabel="本地" rightLabel="远端" />
      {ignoredIds.has(selected) && <p>此文档已忽略远端，合并时仅保留本地；清除忽略后才能选择冲突处理方式。</p>}
      <fieldset className="sync-conflict-choices" disabled={disabled || ignoredIds.has(selected)}><legend>保留版本</legend>
        {(["both", "local", "remote"] as const).map(choice => <label key={choice}>
          <input type="radio" name="conflict-choice" value={choice} checked={(resolutions[selected]?.choice ?? "both") === choice}
            onChange={() => onResolve(selected, { choice, localRevision: left.revision, remoteRevision: right.revision })} />{labels[choice]}
        </label>)}
      </fieldset>
    </>}
  </section>;
}
