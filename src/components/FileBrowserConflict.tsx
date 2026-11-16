import { useEffect, useState } from "react";
import type { BrowserJob, BrowserOperationQueueCore } from "../lib/local-files/browser-queue-core";
import { browserDateText } from "../lib/local-files/browser-display";
import { fileSegments } from "../lib/local-files/file-model";
import { useFileBrowserHost } from "./FileBrowserHost";
export function FileBrowserConflict({ job, queue }: { job: BrowserJob; queue: BrowserOperationQueueCore }) {
  const { provider } = useFileBrowserHost();
  const [alternative, setAlternative] = useState(job.conflict ?? ""), [all, setAll] = useState(false);
  const [details, setDetails] = useState<Array<{ label: string; node: string; size?: number; modifiedMs?: number; error?: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    const paths = job.conflictPaths;
    if (paths) void Promise.all(([['来源', paths.source], ['目标', paths.target]] as const).map(async ([label, path]) => {
      if (!path) return { label, node: "新建项目", error: "尚无磁盘文件" };
      try { const metadata = await provider.properties(path.rootId, path.node, controller.signal); return { label, node: path.node, ...metadata }; }
      catch { return { label, node: path.node, error: "无法读取，文件可能已变化" }; }
    })).then(value => { if (!controller.signal.aborted) setDetails(value); });
    return () => controller.abort();
  }, [job.conflictPaths, provider]);
  let valid = false;
  try { valid = alternative === alternative.trim() && alternative !== job.conflict && fileSegments(alternative).length === 1; } catch { /* The original conflict remains available. */ }
  return <fieldset className="file-browser-conflict"><legend>同名冲突：{job.conflict}</legend>
    <div className="file-browser-conflict-comparison">{details.map(item => <section key={item.label}><strong>{item.label}</strong><p className="local-operation-path">{item.node}</p>{item.error ? <p>{item.error}</p> : <dl><dt>大小</dt><dd>{item.size?.toLocaleString()} bytes</dd><dt>修改时间</dt><dd>{browserDateText(item.modifiedMs)}</dd></dl>}</section>)}</div>
    <p>属性仅供对照；文件可能变化。保留双方会为传入项目添加编号，原有目标保持不变。</p>
    {job.operation.nodes.length > 1 && <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />应用到本任务的后续同名冲突</label>}
    <label>其它名称<input aria-label="冲突后的名称" value={alternative} maxLength={255} onChange={event => setAlternative(event.target.value)} /></label>
    <div><button type="button" onClick={() => queue.decide(job.id, { action: "skip", all })}>跳过此项</button>
      {['copy', 'move'].includes(job.operation.kind) && <button type="button" onClick={() => queue.decide(job.id, { action: "keep-both", all })}>保留双方</button>}
      <button type="button" disabled={!valid} onClick={() => queue.decide(job.id, { action: "rename", name: alternative })}>按新名称重试</button>
    </div>
  </fieldset>;
}
