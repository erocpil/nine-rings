import { useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import { DEFAULT_TYPOGRAPHY, saveWorkbenchTypography, type WorkbenchTypography } from "./typography";

const fonts = [["system", "系统字体"], ["sans", "无衬线"], ["serif", "衬线"], ["monospace", "等宽"]] as const;
export function TypographySettings({ value, store, onClose }: { value: WorkbenchTypography; store: BrowserSettingsStore; onClose: () => void }) {
  const [error, setError] = useState("");
  const update = (patch: Partial<WorkbenchTypography>) => {
    try { saveWorkbenchTypography(store, { ...value, ...patch }); setError(""); }
    catch { setError("无法保存排版设置，请检查本地存储后重试。"); }
  };
  return <WorkspaceDialog title="编辑器排版" onClose={onClose}><div className="workbench-typography-settings">
    <p>仅调整显示，不修改文件内容。设置应用于全部编辑文件，独立于 Nine Rings。</p>
    <label>基础字号<input type="number" aria-label="基础字号" min={12} max={32} value={value.note_font_size} onChange={event => { if (event.target.value) update({ note_font_size: Number(event.target.value) }); }} />px</label>
    <label>正文字体<select aria-label="正文字体" value={value.editor_font_family} onChange={event => update({ editor_font_family: event.target.value as WorkbenchTypography["editor_font_family"] })}>{fonts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>源码字体<select aria-label="源码字体" value={value.source_font_family} onChange={event => update({ source_font_family: event.target.value as WorkbenchTypography["source_font_family"] })}>{fonts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>行距<input type="number" aria-label="编辑器行距" min={1.2} max={2.2} step={0.1} value={value.editor_line_height} onChange={event => { if (event.target.value) update({ editor_line_height: Number(event.target.value) }); }} />倍</label>
    <label>块间距<input type="number" aria-label="编辑器块间距" min={0} max={3} step={0.1} value={value.editor_block_spacing} onChange={event => { if (event.target.value) update({ editor_block_spacing: Number(event.target.value) }); }} />em</label>
    <small>源码默认使用等宽字体；代码块保留原有等宽字体。块间距仅作用于渲染正文。</small>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => update(DEFAULT_TYPOGRAPHY)}>恢复默认排版</button>
  </div></WorkspaceDialog>;
}
