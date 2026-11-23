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
import { readWorkbenchEditorSettings, saveWorkbenchEditorSettings, type WorkbenchEditorSettings } from "./editor-settings";

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
