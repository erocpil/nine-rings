import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { ToolbarIcon, TOOLBAR_ICON_NAMES } from "../../components/ToolbarIcon";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import type { BrowserToolContext } from "../../lib/local-files/browser-tool-context";
import { isTauriRuntime } from "../../lib/runtime";
import { serializeWorkbenchTools, TOOLS_KEY, validateWorkbenchTool, type WorkbenchTool } from "./custom-tools";
const categories = {
  "文件与目录": ["folder", "document", "book", "image", "code", "codeBlock", "table", "save", "download", "export", "link", "tag", "trash"],
  "编辑与操作": ["copy", "cut", "paste", "edit", "rename", "move", "bold", "italic", "strike", "color", "palette", "erase", "formatDocument", "formatSelection"],
  "浏览与布局": ["search", "filter", "refresh", "compare", "panel", "tableRow", "tableColumn", "focus", "expand", "compress", "chevronLeft", "chevronRight", "pageTop", "pageBottom", "pageMiddle"],
  "状态与标记": ["star", "pin", "check", "warning", "info", "lock", "unlock", "eye", "shield", "plus", "minus", "close"],
};
function ToolIcon({ tool }: { tool: WorkbenchTool }) {
  return tool.icon.kind === "image" && tool.icon.value ? <img src={tool.icon.value} alt="" /> : tool.icon.kind === "unicode" ? <span aria-hidden="true">{tool.icon.value}</span> : <ToolbarIcon name={TOOLBAR_ICON_NAMES.find(name => name === tool.icon.value) ?? "plus"} />;
}
const blank = (): WorkbenchTool => ({ id: crypto.randomUUID(), name: "", command: "", arguments: "", hint: "", icon: { kind: "preset", value: "plus" } });
export function CustomTools({ settings, context, onRun, onShowResult, hasResult, tools, onToolsChange }: { settings: BrowserSettingsStore; context: BrowserToolContext | null; onRun: (tool: WorkbenchTool, context: BrowserToolContext | null) => void; onShowResult: () => void; hasResult: boolean; tools: WorkbenchTool[]; onToolsChange: (tools: WorkbenchTool[]) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(blank), [error, setError] = useState(""), [notice, setNotice] = useState(""), [category, setCategory] = useState("文件与目录");

  const imageReader = useRef<FileReader | null>(null);
  useEffect(() => () => imageReader.current?.abort(), []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const message = (text: string) => { clearTimeout(noticeTimer.current); setNotice(text); noticeTimer.current = setTimeout(() => setNotice(""), 5000); };
  const change = (value: Partial<WorkbenchTool>) => setDraft(current => ({ ...current, ...value }));
  const persist = (next: WorkbenchTool[]) => { try { settings.setItem(TOOLS_KEY, serializeWorkbenchTools(next)); onToolsChange(next); setError(""); return true; } catch (cause) { setError(`无法保存工具：${String(cause)}`); return false; } };
  const configure = (tool?: WorkbenchTool) => { imageReader.current?.abort(); setDraft(tool ? { ...tool, icon: { ...tool.icon } } : blank()); setError(""); setOpen(true); };
  const iconNames = category === "其它" ? TOOLBAR_ICON_NAMES.filter(name => !Object.values(categories).flat().includes(name)) : TOOLBAR_ICON_NAMES.filter(name => categories[category as keyof typeof categories]?.includes(name));
  return <>
    {tools.map(tool => tool.kind === "separator" ? <span key={tool.id} role="separator" aria-orientation="vertical" aria-label={tool.name} className="workbench-tool-separator" tabIndex={0} title={`${tool.name} · 右键或 Enter 修改`} onContextMenu={event => { event.preventDefault(); configure(tool); }} onKeyDown={event => { if (event.key === "Enter") configure(tool); }} /> : <button key={tool.id} type="button" aria-label={tool.name} title={!isTauriRuntime() ? `${tool.hint || tool.name}（命令仅桌面版可运行）` : !context ? `${tool.hint || tool.name}（当前未选择目录）` : tool.hint || tool.name} disabled={!isTauriRuntime()} onClick={() => onRun(tool, context)} onContextMenu={event => { event.preventDefault(); configure(tool); }}><ToolIcon tool={tool} /></button>)}
    <button type="button" aria-label="添加工具" title="添加或配置工具栏工具" onClick={() => configure()}><ToolbarIcon name="plus" /></button>
    {hasResult && <button type="button" aria-label="查看上次工具执行" title="查看正在运行或上次执行的工具" onClick={onShowResult}><ToolbarIcon name="info" /></button>}
    {notice && <div className="workbench-tool-notice" role="status">{notice}<button type="button" aria-label="关闭工具结果" onClick={() => setNotice("")}>×</button></div>}
    {open && <WorkspaceDialog title="工具栏工具" onClose={() => setOpen(false)}><div className="workbench-tool-config">
      <aside aria-label="已配置工具"><button type="button" onClick={() => configure()}>新建工具</button>{tools.map(tool => tool.kind === "separator" ? <span key={tool.id} role="separator" aria-orientation="vertical" aria-label={tool.name} className="workbench-tool-separator" tabIndex={0} title={`${tool.name} · 右键或 Enter 修改`} onContextMenu={event => { event.preventDefault(); configure(tool); }} onKeyDown={event => { if (event.key === "Enter") configure(tool); }} /> : <button key={tool.id} type="button" aria-pressed={draft.id === tool.id} onClick={() => configure(tool)}><ToolIcon tool={tool} />{tool.name}</button>)}</aside>
      <form onSubmit={event => { event.preventDefault(); try { validateWorkbenchTool(draft); const next = tools.some(tool => tool.id === draft.id) ? tools.map(tool => tool.id === draft.id ? draft : tool) : [...tools, draft]; if (persist(next)) message("工具已保存"); } catch (cause) { setError(String(cause)); } }}>
        <label>名称<input aria-label="工具名称" value={draft.name} maxLength={80} required onChange={event => change({ name: event.target.value })} /></label>
        <label>工具类型<select aria-label="工具类型" value={draft.kind ?? "command"} onChange={event => change({ kind: event.target.value as WorkbenchTool["kind"], ...(event.target.value === "separator" && !draft.name ? { name: "分隔符" } : {}) })}><option value="command">命令按钮</option><option value="separator">竖线分隔符</option></select></label>
        {draft.kind !== "separator" && <>
        <label>执行方式<select aria-label="工具执行方式" value={draft.execution ?? "launch"} onChange={event => change({ execution: event.target.value as WorkbenchTool["execution"] })}><option value="launch">启动应用（独立运行）</option><option value="capture">命令行（捕获输出与退出码）</option></select></label>
        <label>命令<input aria-label="工具命令" value={draft.command} placeholder="程序名称或完整路径" required onChange={event => change({ command: event.target.value })} /></label>
        <label>参数<textarea aria-label="工具参数" value={draft.arguments} rows={4} placeholder="每行一个参数，无需引号" onChange={event => change({ arguments: event.target.value })} /></label>
        <p className="workbench-tool-help">{'{path} 当前目录 · {file} 首个选中项完整路径 · {name} 名称 · {target} 另一栏目录 · {files} 选中路径（独占一行）。程序直接执行，不自动解析 shell；命令使用磁盘上的已保存文件。'}</p>
        <label>提示信息<input aria-label="工具提示" value={draft.hint} maxLength={256} onChange={event => change({ hint: event.target.value })} /></label>
        <label>图标来源<select aria-label="图标来源" value={draft.icon.kind} onChange={event => change({ icon: { kind: event.target.value as WorkbenchTool["icon"]["kind"], value: event.target.value === "preset" ? "plus" : event.target.value === "unicode" ? "⚙" : "" } })}><option value="preset">预置图标</option><option value="unicode">Unicode / Emoji</option><option value="image">导入图片</option></select></label>
        {draft.icon.kind === "preset" && <><select aria-label="图标分组" value={category} onChange={event => setCategory(event.target.value)}>{[...Object.keys(categories), "其它"].map(name => <option key={name}>{name}</option>)}</select><div className="workbench-icon-grid" role="group" aria-label="预置图标">{iconNames.map(name => <button type="button" key={name} aria-label={`使用图标 ${name}`} title={name} aria-pressed={draft.icon.value === name} onClick={() => change({ icon: { kind: "preset", value: name } })}><ToolbarIcon name={name} /></button>)}</div></>}
        {draft.icon.kind === "unicode" && <input aria-label="Unicode 图标" value={draft.icon.value} onChange={event => change({ icon: { kind: "unicode", value: event.target.value } })} />}
        {draft.icon.kind === "image" && <input type="file" aria-label="导入工具图标" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 128 * 1024 || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) { setError("请选择不超过 128 KiB 的 PNG/JPEG/GIF/WebP 图片。"); return; } imageReader.current?.abort(); const reader = new FileReader(), identity = draft.id; imageReader.current = reader; reader.onload = () => setDraft(current => current.id === identity ? { ...current, icon: { kind: "image", value: String(reader.result) } } : current); reader.onerror = () => setError("无法读取图标图片。"); reader.readAsDataURL(file); }} />}
        <div className="workbench-tool-icon-preview" aria-label="工具图标预览"><ToolIcon tool={draft} /></div>
        </>}
        {error && <p role="alert">{error}</p>}
        <footer>{tools.some(tool => tool.id === draft.id) && <><button type="button" aria-label="工具向左移动" disabled={tools.findIndex(tool => tool.id === draft.id) === 0} onClick={() => { const next = [...tools], at = next.findIndex(tool => tool.id === draft.id); if (at > 0) { [next[at - 1], next[at]] = [next[at], next[at - 1]]; persist(next); } }}>←</button><button type="button" aria-label="工具向右移动" disabled={tools.findIndex(tool => tool.id === draft.id) === tools.length - 1} onClick={() => { const next = [...tools], at = next.findIndex(tool => tool.id === draft.id); if (at >= 0 && at < next.length - 1) { [next[at], next[at + 1]] = [next[at + 1], next[at]]; persist(next); } }}>→</button></>}{tools.some(tool => tool.id === draft.id) && <button type="button" onClick={() => { if (persist(tools.filter(tool => tool.id !== draft.id))) setDraft(blank()); }}>删除工具</button>}<button type="button" onClick={() => setOpen(false)}>关闭</button><button type="submit">保存工具</button></footer>
      </form>
    </div></WorkspaceDialog>}
  </>;
}
