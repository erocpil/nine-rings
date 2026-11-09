import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { browserJobSettled, browserOperationTitles, browserQueueReport, retryBrowserItems, type BrowserJob, type BrowserOperationQueueCore } from "../lib/local-files/browser-queue-core";
import { operationTarget } from "../lib/local-files/browser-operation-contract";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarIcon } from "./ToolbarIcon";
import { FileBrowserQueueHistory } from "./FileBrowserQueueHistory";

const jobLabels = { queued: "排队中", running: "执行中", waiting: "等待决定", completed: "已完成", stopped: "已停止", failed: "执行失败" };
const itemLabels = { pending: "未执行", checking: "预检中", running: "执行中", completed: "成功", skipped: "跳过", failed: "预检失败", uncertain: "需核对" };
function QueueJob({ job, queue, onError }: { job: BrowserJob; queue: BrowserOperationQueueCore; onError: (value: string) => void }) {
  const [expanded, setExpanded] = useState(true), [limit, setLimit] = useState(100), [alternative, setAlternative] = useState("");
  const uncertain = job.items.filter(item => item.status === "uncertain").length;
  const failures = job.items.filter(item => item.status === "failed").length;
  const retry = retryBrowserItems(job);
  return <article className="file-browser-job" aria-label={`任务 ${job.id}`}>
    <header><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "▾" : "▸"} #{job.id} {browserOperationTitles[job.operation.kind]}</button><span>{jobLabels[job.status]}</span></header>
    <p className="local-operation-path">来源：{[job.operation.rootName, job.operation.parent].filter(Boolean).join("/")}{["copy", "move"].includes(job.operation.kind) ? ` → ${operationTarget(job.operation)}` : ""}</p>
    <div role="status"><progress max={job.progress.total} value={job.progress.completed + job.progress.skipped} /><p>{jobLabels[job.status]}：成功 {job.progress.completed} 项，跳过 {job.progress.skipped} 项{failures ? `，预检失败 ${failures} 项` : ""}{uncertain ? `，需核对 ${uncertain} 项` : ""} · {job.progress.completed + job.progress.skipped} / {job.progress.total} 项{job.endedAt && job.startedAt ? ` · ${((job.endedAt - job.startedAt) / 1000).toFixed(1)}s` : ""}</p>{!browserJobSettled(job) && <p>{job.progress.current || "等待前面的任务完成"}</p>}</div>
    {job.error && <p className="file-browser-job-error">{job.error}</p>}
    {uncertain > 0 && <p className="file-browser-job-warning">部分项目可能已写入磁盘，须先核对来源和目标；需核对项不参与重试。</p>}
    {job.conflict !== undefined && <fieldset className="file-browser-conflict"><legend>同名冲突：{job.conflict}</legend><label>其它名称<input aria-label="冲突后的名称" value={alternative || job.conflict} maxLength={255} onChange={event => setAlternative(event.target.value)} /></label><div><button type="button" onClick={() => { setAlternative(""); queue.decide(job.id, { action: "skip" }); }}>跳过此项</button><button type="button" disabled={!alternative.trim() || alternative.trim() === job.conflict} onClick={() => { queue.decide(job.id, { action: "rename", name: alternative }); setAlternative(""); }}>按新名称重试</button></div></fieldset>}
    {expanded && <><ol className="file-browser-job-items">{job.items.slice(0, limit).map((item, index) => <li key={item.node || index} data-state={item.status}><span>{itemLabels[item.status]}</span><span title={item.node || item.targetName}>{item.node || item.targetName}{item.node && item.node.split("/").pop() !== item.targetName ? ` → ${item.targetName}` : ""}{item.error && <small>{item.error}</small>}</span></li>)}</ol>{job.items.length > limit && <button type="button" onClick={() => setLimit(value => value + 100)}>再显示 100 项（共 {job.items.length} 项）</button>}</>}
    {!browserJobSettled(job) ? <button type="button" onClick={() => queue.stop(job.id)}>停止后续项</button> : job.retryId !== undefined ? <p>未完成项已加入任务 #{job.retryId}</p> : retry.length > 0 && <button type="button" onClick={() => { try { queue.retry(job.id); } catch (error) { onError(String(error)); } }}>重试未完成项（{retry.length}）</button>}
  </article>;
}
export function FileBrowserQueueDialog({ queue, onClose }: { queue: BrowserOperationQueueCore; onClose: () => void }) {
  const jobs = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const { message, showMessage } = useTransientMessage();
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useDialogFocus(dialog, true, close, undefined, true);
  const busy = jobs.some(job => !browserJobSettled(job));
  return createPortal(<dialog ref={dialog} className="plugin-parameter-dialog local-file-operation-dialog file-browser-operation-dialog file-browser-queue-dialog" aria-label="文件操作队列" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><strong>文件操作队列</strong><button ref={close} type="button" className="btn-icon" aria-label="收起操作队列" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p>按确认顺序逐项执行。收起后继续；停止会等待当前项结束。成功和跳过项不会重复执行。</p>
    {queue.historyIssue() && <p role="alert" className="file-browser-job-warning">{queue.historyIssue()}</p>}
    <FileBrowserQueueHistory current={queue.historyKey()} onError={value => showMessage(value, "error")} />
    {queue.isPaused() && <p className="file-browser-job-warning">队列因失败暂停。请先核对结果，再继续其余已确认任务。<button type="button" onClick={() => queue.resume()}>继续排队任务</button></p>}
    <div className="file-browser-queue-jobs">{jobs.length ? jobs.map(job => <QueueJob key={job.id} job={job} queue={queue} onError={value => showMessage(value, "error")} />) : <p>当前没有操作记录。</p>}</div>
    {message && <p role="status">{message}</p>}
    <footer><button type="button" disabled={!jobs.length} onClick={() => { void copyToClipboard(browserQueueReport(jobs), { reportFailure: true }).then(() => showMessage("已复制操作结果")).catch(error => showMessage(String(error), "error")); }}>复制结果</button><button type="button" disabled={!jobs.some(browserJobSettled)} onClick={() => queue.clearFinished()}>清除已结束</button>{busy && <button type="button" onClick={() => queue.stopAll()}>停止全部</button>}<button type="button" onClick={onClose}>{busy ? "收起" : "关闭"}</button></footer>
  </dialog>, document.body);
}
