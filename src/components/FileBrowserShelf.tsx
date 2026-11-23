import { useEffect, useRef, useState } from "react";
import { browserShelfId, browserShelfPath, reviewBrowserShelf, type BrowserShelfEntry, type BrowserShelfTarget } from "../lib/local-files/browser-shelf";
import type { BrowserOperation } from "../lib/local-files/browser-operation-contract";
import type { BrowserWorkspaceHost } from "../lib/local-files/browser-workspace-contract";
import { WorkspaceDialog } from "./WorkspaceDialog";

export function FileBrowserShelf({ entries, targets, workspace, onRemove, onSubmit, onClose }: {
  entries: BrowserShelfEntry[]; targets: [BrowserShelfTarget | null, BrowserShelfTarget | null]; workspace: BrowserWorkspaceHost;
  onRemove: (id: string) => void; onSubmit: (operations: BrowserOperation[]) => void; onClose: () => void;
}) {
  const [side, setSide] = useState<0 | 1>(targets[1] ? 1 : 0);
  const [moving, setMoving] = useState(false);
  const [review, setReview] = useState<Awaited<ReturnType<typeof reviewBrowserShelf>>>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const check = async () => {
    const target = targets[side];
    if (!target || busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setReview(undefined);
    try {
      const result = await reviewBrowserShelf(entries, target, moving, workspace.provider, rootId => workspace.canWrite(rootId), request.signal);
      if (!request.signal.aborted) setReview(result);
    } catch (cause) { if (!request.signal.aborted) setError(String(cause)); }
    finally { if (!request.signal.aborted) setBusy(false); }
  };
  const count = review?.operations.reduce((sum, operation) => sum + operation.nodes.length, 0) ?? 0;
  return <WorkspaceDialog title="文件暂存架" onClose={onClose}>
    <div className="file-browser-shelf">
      <div className="file-browser-comparison-controls">
        <label>目标目录 <select aria-label="暂存架目标目录" value={side} disabled={busy} onChange={event => { setSide(event.target.value === "1" ? 1 : 0); setReview(undefined); }}>
          {targets.map((target, index) => <option key={index} value={index} disabled={!target}>{index === 0 ? "左栏" : "右栏"} · {target ? [target.rootName, target.parent].filter(Boolean).join("/") : "未选择目录"}</option>)}
        </select></label>
        <label>操作 <select aria-label="暂存架操作" value={moving ? "move" : "copy"} disabled={busy} onChange={event => { setMoving(event.target.value === "move"); setReview(undefined); }}><option value="copy">复制</option><option value="move">移动</option></select></label>
      </div>
      {!entries.length && <p>从文件列表右键选择「加入文件暂存架」。</p>}
      <ul className="file-browser-plan-items">{entries.map(entry => {
        const id = browserShelfId(entry), issue = review?.invalid.get(id);
        return <li key={id}><strong>{browserShelfPath(entry)}</strong>{review && <span>{issue ?? (moving ? "待移动" : "待复制")}</span>}
          <button type="button" disabled={busy} aria-label={`移除 ${browserShelfPath(entry)}`} onClick={() => { onRemove(id); setReview(undefined); }}>移除</button></li>;
      })}</ul>
      {error && <p role="alert">{error}</p>}
      {review && <p role="status">可入队 {count} 项 · 失效 {review.invalid.size} 项。同名冲突由队列处理。</p>}
      <footer>
        <button type="button" disabled={!entries.length || !targets[side] || busy} onClick={() => void check()}>{busy ? "正在核验…" : "核验并预览"}</button>
        <button type="button" disabled={!count || busy} onClick={() => {
          if (!review) return;
          try { onSubmit(review.operations); } catch (cause) { setError(String(cause)); }
        }}>确认加入队列</button>
      </footer>
    </div>
  </WorkspaceDialog>;
}
