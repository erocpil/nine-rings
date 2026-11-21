import { useState } from "react";
import type { BatchRenameItem, BrowserRenameRules } from "../lib/local-files/browser-rename";
import { validateBrowserRenameRules } from "../lib/local-files/browser-rename";
import { maxBrowserRenamePresets, readBrowserRenamePresets, writeBrowserRenamePresets, type BrowserRenamePreset } from "../lib/local-files/browser-rename-presets";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";

export function FileBrowserRenameFields({ rules, onChange, settings, rows, error, pending, checking, warning }: {
  rules: BrowserRenameRules; onChange: (rules: BrowserRenameRules) => void; settings: BrowserSettingsStore;
  rows: BatchRenameItem[]; error?: string; pending: boolean; checking: boolean; warning?: string;
}) {
  const [stored, setStored] = useState(() => {
    try { return { presets: readBrowserRenamePresets(settings), loadError: false }; }
    catch { return { presets: [], loadError: true }; }
  });
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();
  const change = <Key extends keyof BrowserRenameRules,>(key: Key, value: BrowserRenameRules[Key]) => onChange({ ...rules, [key]: value });
  const save = (remove: boolean) => {
    try {
      const next = name.trim();
      const presets = readBrowserRenamePresets(settings);
      if (!remove) {
        validateBrowserRenameRules(rules);
        if (presets.some(preset => preset.name === next) && next !== selected) throw new Error("已有同名预设，请先选择它再更新");
        if (presets.length >= maxBrowserRenamePresets && !presets.some(preset => preset.name === next)) throw new Error(`最多保存 ${maxBrowserRenamePresets} 个预设`);
      }
      const entry: BrowserRenamePreset = { name: next, rules };
      const updated = remove ? presets.filter(preset => preset.name !== selected)
        : presets.some(preset => preset.name === next) ? presets.map(preset => preset.name === next ? entry : preset)
        : [...presets, entry];
      writeBrowserRenamePresets(settings, updated);
      setStored({ presets: updated, loadError: false });
      setSelected(remove ? "" : next);
      setName(remove ? "" : next);
      setNotice({ message: remove ? "已删除重命名预设" : "已保存重命名预设" });
    } catch (cause) { setNotice({ message: cause instanceof Error ? cause.message : String(cause), error: true }); }
  };
  const bad = rows.filter(row => row.error);
  const review = bad.length && rows.length > 100 ? [...bad, ...rows.filter(row => !row.error)] : rows;
  return <>
    <div className="file-browser-rename-grid">
      <label>查找方式<select value={rules.match} onChange={event => change("match", event.target.value as BrowserRenameRules["match"])}><option value="text">纯文本</option><option value="regex">正则表达式</option></select></label>
      <label>大小写<select value={rules.letterCase} onChange={event => change("letterCase", event.target.value as BrowserRenameRules["letterCase"])}><option value="keep">保持原样</option><option value="lower">转为小写</option><option value="upper">转为大写</option></select></label>
      <label>查找<input value={rules.find} maxLength={255} onChange={event => change("find", event.target.value)} /></label>
      <label>替换为<input value={rules.replacement} maxLength={255} onChange={event => change("replacement", event.target.value)} /></label>
    </div>
    <p>先查找替换，再转换主文件名大小写，最后应用模板。{rules.match === "regex" && "替换可用 $1 等引用分组。"}</p>
    <label>命名模板<input value={rules.template} maxLength={255} onChange={event => change("template", event.target.value)} /></label>
    <div className="file-browser-rename-grid">
      <label>起始编号<input type="number" min={0} max={1000000} value={Number.isNaN(rules.start) ? "" : rules.start} onChange={event => change("start", event.target.valueAsNumber)} /></label>
      <label>编号位数<input type="number" min={1} max={12} value={Number.isNaN(rules.padding) ? "" : rules.padding} onChange={event => change("padding", event.target.valueAsNumber)} /></label>
    </div>
    <p>{"{name} 主文件名 · {ext} 原扩展名（含点） · {n} 按选中顺序编号。未变化项跳过。"}</p>
    <div className="file-browser-rename-grid">
      <label>重命名预设<select value={selected} onChange={event => {
        const preset = stored.presets.find(item => item.name === event.target.value);
        setSelected(preset?.name ?? "");
        setName(preset?.name ?? "");
        setNotice(undefined);
        if (preset) onChange(preset.rules);
      }}><option value="">自定义规则</option>{stored.presets.map(preset => <option key={preset.name}>{preset.name}</option>)}</select></label>
      <label>预设名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} /></label>
    </div>
    <div className="file-browser-rename-preset-actions">
      <button type="button" disabled={!name.trim() || stored.loadError} onClick={() => save(false)}>{selected && selected === name.trim() ? "更新预设" : "保存预设"}</button>
      {selected && <button type="button" onClick={() => save(true)}>删除预设</button>}
    </div>
    {stored.loadError && <p role="alert">无法读取重命名预设。</p>}
    {notice && <p role={notice.error ? "alert" : "status"}>{notice.message}</p>}
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">正在生成正则预览…</p>}
    {checking && <p role="status">正在检查同目录名称…</p>}
    {warning && <p role="status">{warning}</p>}
    {!!bad.length && <p role="alert">{bad.length} 项存在名称问题，请调整规则。</p>}
    {!!rows.length && <div className="file-browser-rename-preview" aria-label="重命名预览">
      {review.slice(0, 100).map(item => <p key={item.node}>{item.name} → {item.next || "（空）"}{item.error ? <strong>（{item.error}）</strong> : !item.changed && "（不变）"}</p>)}
      {rows.length > 100 && <p>显示 {Math.min(100, rows.length)} / {rows.length} 项，名称问题优先。</p>}
    </div>}
  </>;
}
