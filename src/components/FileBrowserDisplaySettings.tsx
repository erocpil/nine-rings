import type { BrowserDisplay } from "../lib/local-files/browser-display";
import { WorkspaceDialog } from "./WorkspaceDialog";
export function FileBrowserDisplaySettings({ display, inherited, onChange, onClose }: {
  display: BrowserDisplay; inherited: boolean; onChange: (patch: Partial<BrowserDisplay> | { inherited: boolean }) => void; onClose: () => void;
}) {
  return <WorkspaceDialog title="文件列表展示" onClose={onClose}><div className="file-browser-display-settings">
    <label><input type="checkbox" checked={inherited} onChange={event => onChange({ inherited: event.target.checked })} />使用统一默认设置</label>
    <p>{inherited ? "修改以下选项会应用到所有使用默认设置的目录栏。" : "以下选项仅应用到当前一侧，所有目录标签共用。"}列宽和排序保持不变。</p>
    <label>字号<input type="number" aria-label="列表字号" min={12} max={20} value={display.fontSize} onChange={event => { if (event.target.value) onChange({ fontSize: Number(event.target.value) }); }} />px</label>
    <label>行高<input type="number" aria-label="列表行高" min={Math.max(28, display.fontSize + 12)} max={48} value={display.rowHeight} onChange={event => { if (event.target.value) onChange({ rowHeight: Number(event.target.value) }); }} />px</label>
    <fieldset><legend>显示列（名称始终显示）</legend>{([['type', '类型'], ['size', '大小'], ['modified', '修改时间']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={display[key]} onChange={event => onChange({ [key]: event.target.checked })} />{label}</label>)}</fieldset>
    <label>日期格式<select aria-label="列表日期格式" value={display.dateFormat} onChange={event => onChange({ dateFormat: event.target.value as BrowserDisplay['dateFormat'] })}><option value="local">跟随系统</option><option value="iso">YYYY-MM-DD HH:mm:ss</option><option value="date">YYYY-MM-DD</option></select></label>
  </div></WorkspaceDialog>;
}
