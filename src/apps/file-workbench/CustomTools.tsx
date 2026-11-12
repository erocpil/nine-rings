import { createPortal } from "react-dom";
import { isMacPlatform } from "../../lib/shortcuts";
import { FileBrowserContextMenu, type FileBrowserMenuAction } from "../../components/FileBrowserContextMenu";
import type { NotesMenuTarget } from "../../components/NotesContextMenu";
import { useContext } from "react";
import { FileBrowserDragContext } from "../../components/FileBrowserHost";
import { BROWSER_DRAG_TYPE } from "../../lib/local-files/browser-drag";
import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { ToolbarIcon, TOOLBAR_ICON_NAMES } from "../../components/ToolbarIcon";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import type { BrowserToolContext } from "../../lib/local-files/browser-tool-context";
import { isTauriRuntime } from "../../lib/runtime";
import { serializeWorkbenchTools, workbenchDropInvocation, TOOLS_KEY, validateWorkbenchTool, type WorkbenchTool } from "./custom-tools";
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
export function CustomTools({ settings, context, onRun, onShowResult, hasResult, tools, onToolsChange }: { settings: BrowserSettingsStore; context: BrowserToolContext | null; onRun: (tool: WorkbenchTool, context: BrowserToolContext | null, direct?: boolean) => void; onShowResult: () => void; hasResult: boolean; tools: WorkbenchTool[]; onToolsChange: (tools: WorkbenchTool[]) => void }) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  const dragging = useContext(FileBrowserDragContext);
  const [dropTool, setDropTool] = useState<string | null>(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(blank), [error, setError] = useState(""), [notice, setNotice] = useState(""), [category, setCategory] = useState("文件与目录");

  const imageReader = useRef<FileReader | null>(null);
  useEffect(() => () => imageReader.current?.abort(), []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const message = (text: string) => { clearTimeout(noticeTimer.current); setNotice(text); noticeTimer.current = setTimeout(() => setNotice(""), 5000); };
  const change = (value: Partial<WorkbenchTool>) => setDraft(current => ({ ...current, ...value }));
  const persist = (next: WorkbenchTool[]) => { try { settings.setItem(TOOLS_KEY, serializeWorkbenchTools(next)); onToolsChange(next); setError(""); return true; } catch (cause) { setError(`无法保存工具：${String(cause)}`); message(`无法保存工具：${String(cause)}`); return false; } };
  const configure = (tool?: WorkbenchTool) => { imageReader.current?.abort(); setDraft(tool ? { ...tool, icon: { ...tool.icon } } : blank()); setError(""); setOpen(true); };
  const showMenu = (event: React.MouseEvent<HTMLElement>, tool: WorkbenchTool) => { event.preventDefault(); event.stopPropagation(); setMenu({ id: tool.id, title: tool.name, x: event.clientX, y: event.clientY, trigger: event.currentTarget }); };
  const move = (id: string, direction: number) => { const next = [...tools], at = next.findIndex(tool => tool.id === id), to = at + direction; if (at >= 0 && to >= 0 && to < next.length) { [next[at], next[to]] = [next[to], next[at]]; persist(next); } };
  const selectedTool = tools.find(tool => tool.id === menu?.id);
  const menuActions = (tool: WorkbenchTool): FileBrowserMenuAction[] => {
    const at = tools.findIndex(item => item.id === tool.id), separator = tool.kind === "separator", native = isTauriRuntime();
    return [
      ...(!separator ? [
        { label: tool.execution === "capture" ? "运行（不带参数）" : "打开应用", disabled: !native, run: () => onRun({ ...tool, arguments: "" }, context, true) },
        { label: "打开当前选中文件", disabled: !native || !context?.selected.length, run: () => { if (!context?.selected.length) return; const invocation = workbenchDropInvocation(tool, context, { rootId: context.rootId, rootName: "", parent: context.node, nodes: context.selected }); onRun(invocation.tool, invocation.context); } },
        { label: "使用配置参数运行", disabled: !native, run: () => onRun(tool, context) },
      ] : []),
      { label: separator ? "编辑分隔符" : "编辑工具", separator: !separator, run: () => configure(tool) },
      ...(!separator ? [{ label: "复制工具", run: () => persist([...tools.slice(0, at + 1), { ...tool, id: crypto.randomUUID(), name: `${tool.name.slice(0, 75)} 副本`, icon: { ...tool.icon } }, ...tools.slice(at + 1)]) }] : []),
      { label: "向左移动", separator: true, disabled: at === 0, run: () => move(tool.id, -1) },
      { label: "向右移动", disabled: at === tools.length - 1, run: () => move(tool.id, 1) },
      ...(!separator ? [{ label: "在此前插入分隔符", run: () => persist([...tools.slice(0, at), { ...blank(), kind: "separator" as const, name: "分隔符" }, ...tools.slice(at)]) }] : []),
      { label: separator ? "删除分隔符" : "删除此工具", separator: true, danger: true, run: () => persist(tools.filter(item => item.id !== tool.id)) },
    ];
  };
  const iconNames = category === "其它" ? TOOLBAR_ICON_NAMES.filter(name => !Object.values(categories).flat().includes(name)) : TOOLBAR_ICON_NAMES.filter(name => categories[category as keyof typeof categories]?.includes(name));
  return <>
    {tools.map(tool => tool.kind === "separator" ? <span key={tool.id} role="separator" aria-orientation="vertical" aria-label={tool.name} className="workbench-tool-separator" tabIndex={0} title={`${tool.name} · 右键菜单 · Enter 修改`} onContextMenu={event => showMenu(event, tool)} onKeyDown={event => { if (event.key === "Enter") configure(tool); }} /> : <button key={tool.id} type="button" aria-label={tool.name} title={!isTauriRuntime() ? `${tool.hint || tool.name}（命令仅桌面版可运行）` : !context ? `${tool.hint || tool.name}（当前未选择目录）` : tool.hint || tool.name} disabled={!isTauriRuntime()} data-tool-drop={dropTool === tool.id || undefined} onDragOver={event => {
      if (!dragging?.current() || !event.dataTransfer.types.includes(BROWSER_DRAG_TYPE)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropTool(tool.id);
    }} onDragLeave={() => setDropTool(null)} onDrop={event => {
      event.preventDefault(); setDropTool(null);
      const source = dragging?.take(event.dataTransfer.getData(BROWSER_DRAG_TYPE));
      if (!source) return;
      const invocation = workbenchDropInvocation(tool, context, source); onRun(invocation.tool, invocation.context);
    }} onClick={event => { if (event.ctrlKey && isMacPlatform()) return; onRun({ ...tool, arguments: "" }, context, true); }} onContextMenu={event => showMenu(event, tool)}><ToolIcon tool={tool} /></button>)}
    <button type="button" aria-label="添加工具" title="添加或配置工具栏工具" onClick={() => configure()}><ToolbarIcon name="plus" /></button>
    {hasResult && <button type="button" aria-label="查看上次工具执行" title="查看正在运行或上次执行的工具" onClick={onShowResult}><ToolbarIcon name="info" /></button>}
    {notice && createPortal(<div className="workbench-tool-notice" role="status">{notice}<button type="button" aria-label="关闭工具结果" onPointerDown={event => event.preventDefault()} onClick={() => setNotice("")}>×</button></div>, document.body)}
    {menu && selectedTool && <FileBrowserContextMenu target={menu} actions={menuActions(selectedTool)} close={() => setMenu(null)} />}
    {open && <WorkspaceDialog title="工具栏工具" onClose={() => setOpen(false)}><div className="workbench-tool-config">
      <aside aria-label="已配置工具"><button type="button" onClick={() => configure()}>新建工具</button>{tools.map(tool => <button key={tool.id} type="button" aria-pressed={draft.id === tool.id} onClick={() => configure(tool)}>{tool.kind === "separator" ? <><span aria-hidden="true">│</span>{tool.name}（分隔符）</> : <><ToolIcon tool={tool} />{tool.name}</>}</button>)}</aside>
      <form onSubmit={event => { event.preventDefault(); try { validateWorkbenchTool(draft); const next = tools.some(tool => tool.id === draft.id) ? tools.map(tool => tool.id === draft.id ? draft : tool) : [...tools, draft]; if (persist(next)) message("工具已保存"); } catch (cause) { setError(String(cause)); } }}>
        <label>名称<input aria-label="工具名称" value={draft.name} maxLength={80} required onChange={event => change({ name: event.target.value })} /></label>
        <label>工具类型<select aria-label="工具类型" value={draft.kind ?? "command"} onChange={event => change({ kind: event.target.value as WorkbenchTool["kind"], ...(event.target.value === "separator" && !draft.name ? { name: "分隔符" } : {}) })}><option value="command">命令按钮</option><option value="separator">竖线分隔符</option></select></label>
        {draft.kind !== "separator" && <>
        <label>执行方式<select aria-label="工具执行方式" value={draft.execution ?? "launch"} onChange={event => change({ execution: event.target.value as WorkbenchTool["execution"] })}><option value="launch">启动应用（独立运行）</option><option value="capture">命令行（捕获输出与退出码）</option></select></label>
        <label>命令<input aria-label="工具命令" value={draft.command} placeholder="程序名称或完整路径" required onChange={event => change({ command: event.target.value })} /></label>
        <label>配置运行及拖放参数<textarea aria-label="工具参数" value={draft.arguments} rows={4} placeholder="每行一个参数，无需引号" onChange={event => change({ arguments: event.target.value })} /></label>
        <p className="workbench-tool-help">{'单击：不带参数启动；右键可使用配置参数运行或打开选中文件；拖放：使用配置参数并传入拖入的文件，已有文件占位符时不重复追加。{path} 当前目录 · {file} 首个选中项完整路径 · {name} 名称 · {target} 另一栏目录 · {files} 选中路径（独占一行）。程序直接执行，不自动解析 shell；命令使用磁盘上的已保存文件。'}</p>
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
