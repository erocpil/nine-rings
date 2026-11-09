import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { operationTarget, type BrowserOperation } from "../lib/local-files/browser-operation-contract";
import { browserOperationTitles } from "../lib/local-files/browser-queue-core";
import { ToolbarIcon } from "./ToolbarIcon";
import { planBrowserRename, type BatchRenameItem } from "../lib/local-files/browser-tools";

/** Review only: the activation-owned queue owns confirmed disk operations. */
export function FileBrowserOperationDialog({ operation, onConfirm, onClose }: { operation: BrowserOperation; onConfirm: (operation: BrowserOperation, name: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null);
  const submitted = useRef(false);
  const [name, setName] = useState(operation.kind === "file" ? "未命名.txt" : operation.kind === "directory" ? "新建文件夹" : operation.nodes[0]?.split("/").pop() ?? "");
  const [error, setError] = useState("");
  const [template, setTemplate] = useState("{name}{ext}"), [start, setStart] = useState(1);
  let plan: BatchRenameItem[] = [], planError = "";
  if (operation.kind === "batch-rename") { try { plan = planBrowserRename(operation.nodes, template, start); } catch (cause) { planError = String(cause); } }
  const title = browserOperationTitles[operation.kind];
  const needsName = ["file", "directory", "rename"].includes(operation.kind);
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useDialogFocus(dialog, true, needsName ? first : close, undefined, true);
  const run = () => {
    if (submitted.current || (operation.kind === "batch-rename" && (planError || !plan.some(item => item.changed)))) return;
    submitted.current = true;
    try {
      const changed = plan.filter(item => item.changed);
      onConfirm(operation.kind === "batch-rename" ? { ...operation, nodes: changed.map(item => item.node), names: Object.fromEntries(changed.map(item => [item.node, item.next])) } : operation, name);
    } catch (cause) { submitted.current = false; setError(String(cause)); }
  };
  return createPortal(<dialog ref={dialog} className="plugin-parameter-dialog local-file-operation-dialog file-browser-operation-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); run(); }}>
      <header><strong>{title}</strong><button ref={close} type="button" className="btn-icon" aria-label="关闭文件操作" onClick={onClose}><ToolbarIcon name="close" /></button></header>
      <p className="local-operation-path">来源：{[operation.rootName, operation.parent].filter(Boolean).join("/")}</p>
      {operation.nodes.length > 0 && <p className="local-operation-path">选中 {operation.nodes.length} 项：{operation.nodes.slice(0, 8).map(node => node.split("/").pop()).join("、")}{operation.nodes.length > 8 ? "…" : ""}</p>}
      {(["copy", "move"].includes(operation.kind)) && <p className="local-operation-path">目标：{operationTarget(operation)}</p>}
      {needsName && <label>名称<input ref={first} aria-label="名称" value={name} maxLength={255} required onChange={event => setName(event.target.value)} /></label>}
      {operation.kind === "batch-rename" && <><label>命名模板<input aria-label="命名模板" value={template} maxLength={255} onChange={event => setTemplate(event.target.value)} /></label><label>起始编号<input aria-label="起始编号" type="number" min={0} max={1000000} value={Number.isNaN(start) ? "" : start} onChange={event => setStart(event.target.valueAsNumber)} /></label><p>{"{name} 名称 · {ext} 扩展名（含点） · {n} 按选中顺序编号。未变化项跳过。"}</p>{planError ? <p role="alert">{planError}</p> : <div className="file-browser-rename-preview" aria-label="重命名预览">{plan.slice(0, 100).map(item => <p key={item.node}>{item.name} → {item.next}{item.changed ? "" : "（不变）"}</p>)}{plan.length > 100 && <p>仅列出前 100 项，共 {plan.length} 项。</p>}</div>}</>}
      <p>{operation.kind === "trash" ? "移入系统回收站，不永久删除。" : "同名目标不会被覆盖；冲突时可跳过或改名。"}未保存编辑须先处理。</p>
      <p>确认后加入串行队列；执行时重新检查授权、来源和未保存编辑。目录包含全部子项和隐藏项，整个目录计为一项。</p>
      {operation.kind === "move" && <p>同磁盘直接移动；跨磁盘先复制并校验，成功后将来源移入系统回收站。大文件校验可能较久；收尾失败时会保留目标并要求核对。</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={(operation.kind === "batch-rename" && (Boolean(planError) || !plan.some(item => item.changed))) || (needsName && (!name.trim() || (operation.kind === "rename" && name.trim() === operation.nodes[0]?.split("/").pop())))}>确认</button></footer>
    </form>
  </dialog>, document.body);
}
