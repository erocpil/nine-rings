import { useState } from "react";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import {
  DEFAULT_EDITOR_FOLD_ICONS,
  EDITOR_FOLD_PRESETS,
  editorFoldPreset,
  editorFoldPresetPatch,
  outlineFoldStyle,
  scopedFoldOverridePatch,
  scopedFoldPreset,
  type EditorFoldIconConfig,
  type EditorFoldIconScope,
} from "../lib/editor-fold-icons";
import type { AppConfig } from "../lib/storage/types";
import { EditorFoldIcon, EditorFoldIconContext } from "./EditorFoldIcon";
import { ToolbarIcon } from "./ToolbarIcon";

const scopes: { id: EditorFoldIconScope; label: string }[] = [
  { id: "heading", label: "文本区标题" },
  { id: "block", label: "代码／引用块" },
  { id: "outline", label: "文档目录" },
];

export function SettingsFoldIcons({ config, onChange }: {
  config: AppConfig;
  onChange: (partial: Partial<AppConfig>) => void;
}) {
  const numbering = useNumberingDisplay();
  const owned = Boolean(numbering.blocks || numbering.source);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const customInput = (scope: EditorFoldIconScope, expanded: boolean) => {
    const key = expanded ? "expanded" : "collapsed";
    const override = config.editor_fold_icon_overrides[scope];
    const current = override?.[key] ?? (scope === "outline"
      ? (expanded ? config.editor_fold_icon_expanded : config.editor_fold_icon_collapsed)
      : "");
    return <input className="settings-input" aria-label={`${scopes.find(item => item.id === scope)?.label} ${expanded ? "展开" : "收起"}符号`}
      disabled={scope !== "outline" && owned} maxLength={8} value={current}
      onChange={event => onChange({ editor_fold_icon_overrides: {
        ...config.editor_fold_icon_overrides,
        [scope]: { ...override, style: "custom", [key]: Array.from(event.target.value).slice(0, 4).join("") },
      } })} />;
  };
  const globalPreset = editorFoldPreset(config);
  const chooseGlobal = (preset: string) => onChange(editorFoldPresetPatch(preset));
  const chooseScope = (scope: EditorFoldIconScope, preset: string) => onChange({
    editor_fold_icon_overrides: scopedFoldOverridePatch(config, scope, preset),
  });
  const displayPreset = (scope: EditorFoldIconScope) => {
    if (scope === "outline" && !config.editor_fold_icon_overrides.outline) return outlineFoldStyle(config);
    return scopedFoldPreset(config, scope);
  };

  return <div className="settings-fold-icons">
    {owned && <p className="settings-desc">编号展示插件正在接管折叠符号，相关内置设置暂时禁用，原设置保留。</p>}
    <label>
      通用折叠标识
      <select className="settings-input" aria-label="折叠标识样式" disabled={owned} value={globalPreset} onChange={event => chooseGlobal(event.target.value)}>
        {EDITOR_FOLD_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        <option value="custom">自定义符号</option>
      </select>
    </label>
    {config.editor_fold_icon_style === "custom" && <>
      <label>
        收起状态（点击展开）
        <input className="settings-input" aria-label="收起状态符号" disabled={owned} maxLength={8}
          value={config.editor_fold_icon_collapsed ?? DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_collapsed}
          onChange={event => onChange({ editor_fold_icon_collapsed: Array.from(event.target.value).slice(0, 4).join("") })} />
      </label>
      <label>
        展开状态（点击收起）
        <input className="settings-input" aria-label="展开状态符号" disabled={owned} maxLength={8}
          value={config.editor_fold_icon_expanded ?? DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_expanded}
          onChange={event => onChange({ editor_fold_icon_expanded: Array.from(event.target.value).slice(0, 4).join("") })} />
      </label>
      <div className="settings-hint">建议使用单个符号，最多 4 个字符；留空时使用默认三角。</div>
    </>}

    <button type="button" className="settings-fold-details-toggle" aria-expanded={detailsOpen}
      onClick={() => setDetailsOpen(value => !value)}>
      <span>{detailsOpen ? "收起分位置设置" : "分别设置各处折叠标识"}</span>
      <span className={`settings-fold-details-chevron${detailsOpen ? " open" : ""}`}><ToolbarIcon name="chevronDown" /></span>
    </button>
    {detailsOpen && <div className="settings-fold-details" aria-label="分位置折叠标识设置">
      {scopes.map(({ id, label }) => {
        const preset = displayPreset(id);
        const isCustom = preset === "custom";
        const disabled = owned && id !== "outline";
        return <section className="settings-fold-scope" key={id}>
          <label>
            {label}
            <select className="settings-input" aria-label={`${label}折叠标识`} disabled={disabled} value={preset}
              onChange={event => chooseScope(id, event.target.value)}>
              <option value="inherit">跟随通用设置</option>
              {EDITOR_FOLD_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              <option value="custom">自定义符号</option>
            </select>
          </label>
          {isCustom && <div className="settings-fold-scope-symbols">
            <label>收起 {customInput(id, false)}</label>
            <label>展开 {customInput(id, true)}</label>
          </div>}
        </section>;
      })}
    </div>}
    <EditorFoldIconContext.Provider value={config as EditorFoldIconConfig}>
      <div className="settings-fold-preview" aria-label="折叠标识预览">
        <span className="settings-fold-preview-heading">标题：收起 <EditorFoldIcon scope="heading" expanded={false} /></span>
        <span className="settings-fold-preview-heading">展开 <EditorFoldIcon scope="heading" expanded /></span>
        {detailsOpen && <>
          <span className="settings-fold-preview-block">代码／引用：<EditorFoldIcon scope="block" expanded={false} /></span>
          <span className="settings-fold-preview-outline">目录：<EditorFoldIcon outline expanded={false} /></span>
        </>}
      </div>
    </EditorFoldIconContext.Provider>
  </div>;
}
