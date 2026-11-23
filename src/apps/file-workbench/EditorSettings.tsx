import { useState } from "react";
import { createPortal } from "react-dom";
import { EditorAppearancePanel } from "../../components/EditorAppearancePanel";
import { EditorSettingsContent } from "../../components/EditorSettingsContent";
import { DocumentWorkspaceModeControl } from "../../components/DocumentWorkspaceModeControl";
import { Field } from "../../components/SettingsFields";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { DEFAULT_CONFIG } from "../../lib/storage/types";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";
import type { AppConfig } from "../../types/models";
import { useWorkbenchPaletteSetting, WORKBENCH_PALETTES } from "./Palette";
import { DEFAULT_TYPOGRAPHY, saveWorkbenchTypography, type WorkbenchTypography } from "./typography";
import { readWorkbenchEditorSettings, saveWorkbenchEditorSettings, WORKBENCH_TAB_WIDTH, type WorkbenchEditorSettings } from "./editor-settings";

const tabWidthOptions = Array.from({ length: WORKBENCH_TAB_WIDTH.max - WORKBENCH_TAB_WIDTH.min + 1 }, (_, index) => WORKBENCH_TAB_WIDTH.min + index);

export function WorkbenchEditorSettingsDialog({ typography, config, store, onClose }: {
  typography: WorkbenchTypography;
  config: WorkbenchEditorSettings;
  store: BrowserSettingsStore;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Partial<WorkbenchTypography> | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const { palette, choosePalette } = useWorkbenchPaletteSetting(store);
  const editorConfig = { ...DEFAULT_CONFIG, ...typography, ...config, interface_style: "classic" as const };
  const update = (save: () => void) => {
    try { save(); setError(""); }
    catch { setError("无法保存编辑器设置，请检查本地存储后重试。"); }
  };
  const closeAppearance = () => { setDraft(null); setPreviewing(false); };

  if (draft) return createPortal(<div className={previewing ? "workbench-appearance-previewing" : undefined}>
    <EditorAppearancePanel
      config={{ ...editorConfig, ...draft }}
      dirty={Object.keys(draft).some(key => draft[key as keyof WorkbenchTypography] !== typography[key as keyof WorkbenchTypography])}
      sourceFontFamily={draft.source_font_family ?? typography.source_font_family}
      onSourceFontChange={value => setDraft(current => ({ ...current, source_font_family: value }))}
      appearanceDefaults={DEFAULT_TYPOGRAPHY}
      mobile={window.matchMedia("(max-width: 760px)").matches}
      onClose={closeAppearance}
      onPreviewChange={setPreviewing}
      onUpdate={(patch: Partial<AppConfig>) => setDraft(current => ({ ...current, ...patch }))}
      onApply={async display => {
        saveWorkbenchTypography(store, { ...typography, ...draft }, display);
        closeAppearance();
      }}
    />
  </div>, document.body);

  return <WorkspaceDialog title="编辑器设置" onClose={onClose}>
    <div className="workbench-editor-settings">
      {error && <p role="alert">{error}</p>}
      <Field label="文件标签宽度" desc="按半角字符数计算文件名区域。空间不足的文件名会省略，悬停可看全名。">
        <select className="settings-input" aria-label="文件标签宽度" value={config.tab_width_chars}
          onChange={event => update(() => { saveWorkbenchEditorSettings(store, readWorkbenchEditorSettings(store), { tab_width_chars: Number(event.target.value) }); })}>
          {tabWidthOptions.map(width => <option key={width} value={width}>{width} 个半角字符{width === WORKBENCH_TAB_WIDTH.default ? "（默认）" : ""}</option>)}
        </select>
      </Field>
      <Field label="短文件名标签" desc="收缩模式下，短文件名可占用更少空间，较长的标签仍以设置的宽度为上限。">
        <select className="settings-input" aria-label="短文件名标签" value={config.shrink_short_tabs ? "shrink" : "fixed"}
          onChange={event => update(() => { saveWorkbenchEditorSettings(store, readWorkbenchEditorSettings(store), { shrink_short_tabs: event.target.value === "shrink" }); })}>
          <option value="fixed">保持指定宽度</option>
          <option value="shrink">按名称收缩</option>
        </select>
      </Field>
      <Field label="固定面板布局" desc="文档布局可同时固定多个面板；紧凑布局默认一次固定一个。拖拽形成的自定义布局优先，恢复默认面板布局可清除自定义排列。">
        <DocumentWorkspaceModeControl origin="local" label="固定面板布局模式" onError={setError} />
      </Field>
      <EditorSettingsContent config={editorConfig} openAppearance={() => setDraft({})}
        update={patch => update(() => { saveWorkbenchEditorSettings(store, readWorkbenchEditorSettings(store), patch); })}
        palette={<select className="settings-input" aria-label="配色" value={palette} onChange={event => update(() => choosePalette(event.target.value))}>
          {WORKBENCH_PALETTES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>}
      />
    </div>
  </WorkspaceDialog>;
}
