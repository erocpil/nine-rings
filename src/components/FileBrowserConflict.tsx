import { useEffect, useState } from "react";
import type { BrowserJob, BrowserOperationQueueCore } from "../lib/local-files/browser-queue-core";
import { browserDateText } from "../lib/local-files/browser-display";
import { fileSegments } from "../lib/local-files/file-model";
import { useFileBrowserHost } from "./FileBrowserHost";
import type { ReplacementReview } from "../lib/local-files/browser-operation-contract";
export function FileBrowserConflict({ job, queue }: { job: BrowserJob; queue: BrowserOperationQueueCore }) {
  const { provider, previewReplacement } = useFileBrowserHost();
  const [alternative, setAlternative] = useState(job.conflict ?? ""), [all, setAll] = useState(false);
  const [details, setDetails] = useState<Array<{ label: string; node: string; size?: number; modifiedMs?: number; error?: string }>>([]);
  const [review, setReview] = useState<ReplacementReview>();
  const [reviewError, setReviewError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const paths = job.conflictPaths;
    if (paths) void Promise.all(([['来源', paths.source], ['目标', paths.target]] as const).map(async ([label, path]) => {
      if (!path) return { label, node: "新建项目", error: "尚无磁盘文件" };
      try { const metadata = await (provider.details?.(path.rootId, path.node, controller.signal) ?? provider.properties(path.rootId, path.node, controller.signal)); return { label, node: path.node, ...metadata }; }
      catch { return { label, node: path.node, error: "无法读取，文件可能已变化" }; }
    })).then(value => { if (!controller.signal.aborted) setDetails(value); });
    return () => controller.abort();
  }, [job.conflictPaths, provider]);
  const inspectReplacement = async () => {
    const paths = job.conflictPaths;
    if (!previewReplacement || !paths?.source) return;
    setReviewError("正在校验两份文件…");
    try {
      const checked = await previewReplacement({ rootId: paths.source.rootId, node: paths.source.node, targetRootId: paths.target.rootId, targetNode: paths.target.node });
      if (!checked?.source?.digest || !checked?.target?.digest) throw new Error("无法读取文件修订");
      setReview(checked);
      setReviewError("");
    } catch (cause) { setReviewError(String(cause)); }
  };
  let valid = false;
  try { valid = alternative === alternative.trim() && alternative !== job.conflict && fileSegments(alternative).length === 1; } catch { /* The original conflict remains available. */ }
  return <fieldset className="file-browser-conflict"><legend>同名冲突：{job.conflict}</legend>
    <div className="file-browser-conflict-comparison">{details.map(item => <section key={item.label}><strong>{item.label}</strong><p className="local-operation-path">{item.node}</p>{item.error ? <p>{item.error}</p> : <dl><dt>大小</dt><dd>{item.size?.toLocaleString()} bytes</dd><dt>修改时间</dt><dd>{browserDateText(item.modifiedMs)}</dd></dl>}</section>)}</div>
    <p>属性仅供对照，目录大小不递归累计；文件可能变化。保留双方会为传入项目添加编号，原有目标保持不变。</p>
    {job.operation.nodes.length > 1 && <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />应用到本任务的后续同名冲突</label>}
    <label>其它名称<input aria-label="冲突后的名称" value={alternative} maxLength={255} onChange={event => setAlternative(event.target.value)} /></label>
    <div><button type="button" onClick={() => queue.decide(job.id, { action: "skip", all })}>跳过此项</button>
      {['copy', 'move'].includes(job.operation.kind) && <button type="button" onClick={() => queue.decide(job.id, { action: "keep-both", all })}>保留双方</button>}
      <button type="button" disabled={!valid} onClick={() => queue.decide(job.id, { action: "rename", name: alternative })}>按新名称重试</button>
      {previewReplacement && job.operation.kind === "copy" && !review && <button type="button" disabled={reviewError === "正在校验两份文件…"} onClick={() => void inspectReplacement()}>检查能否替换</button>}
    </div>
    {reviewError && <p role="status">{reviewError}</p>}
    {review && <section aria-label="替换确认">
      <dl>
        <dt>来源修订</dt><dd>{review.source.size.toLocaleString()} bytes · {browserDateText(review.source.modifiedMs)} · SHA-256 {review.source.digest.slice(0, 12)}</dd>
        <dt>目标修订</dt><dd>{review.target.size.toLocaleString()} bytes · {browserDateText(review.target.modifiedMs)} · SHA-256 {review.target.digest.slice(0, 12)}</dd>
      </dl>
      <p>只替换这一项。原目标将保留在同一目录下的备份中。</p>
      <button type="button" onClick={() => queue.decide(job.id, { action: "replace", expected: review })}>确认替换并保留备份</button>
      <button type="button" onClick={() => setReview(undefined)}>取消替换</button>
    </section>}
  </fieldset>;
}
