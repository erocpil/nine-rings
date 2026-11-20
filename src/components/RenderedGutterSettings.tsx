import { useContext, useRef, useState } from "react";
import type { AppConfig } from "../types/models";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useRelativeNumbering } from "../hooks/useRelativeNumbering";
import { useBlockDisplayPreferences } from "../hooks/useBlockDisplayPreferences";
import { foldGutterVisibilityAction, saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { EDITOR_FOLD_PRESETS, editorFoldPreset, editorFoldPresetPatch } from "../lib/editor-fold-icons";
import { editorCommandTrigger } from "../lib/editor-command-surface";
import { BlockActionMenu } from "./BlockActionMenu";
import { EditorFoldIconContext } from "./EditorFoldIconContext";
import { WorkspaceDialog } from "./WorkspaceDialog";

/** Both full and virtual readers use the host's existing settings authority.
 * Rendering controls never expose source-only whitespace or indentation. */
export function RenderedGutterSettings({ visible, onConfigChange }: {
  visible: boolean;
  onConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const numbering = useNumberingDisplay();
  const relative = useRelativeNumbering();
  const preferences = useBlockDisplayPreferences();
  const foldConfig = useContext(EditorFoldIconContext);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const sharedOwned = Boolean(numbering.blocks || numbering.source);
  const save = async (patch: Partial<AppConfig>) => {
    if (!onConfigChange || busy.current) return;
    busy.current = true;
    setSaving(true);
    try { await onConfigChange(patch); }
    catch (cause) { setTrigger(null); setError(cause instanceof Error ? cause.message : "显示设置保存失败，请重试。"); }
    finally { busy.current = false; setSaving(false); }
  };
  return <>
    <button type="button" className="editor-status-select source-gutter-settings" aria-label="块号与折叠设置" title="块号与折叠设置"
      aria-haspopup="menu" aria-expanded={Boolean(trigger)} onMouseDown={event => event.preventDefault()}
      onClick={event => { const target = editorCommandTrigger(event.currentTarget); setTrigger(previous => previous ? null : target); }}>
      # <span aria-hidden="true">▾</span>
    </button>
    {trigger && <BlockActionMenu trigger={trigger} placement="below" title="块号与折叠设置" onClose={() => setTrigger(null)} actions={[
      ...(sharedOwned ? [{ label: "编号与默认折叠图标由编号展示插件管理", disabled: true, run: () => {} }] : []),
      { label: "显示块号", group: "块号", checked: visible, disabled: sharedOwned || saving || !onConfigChange, keepOpen: true,
        run: () => { void save({ editor_show_line_numbers: !visible }); } },
      { label: "相对块号", checked: relative.relativeBlockNumbers, disabled: Boolean(numbering.blocks) || !visible, keepOpen: true,
        run: () => saveBlockWorkspacePreferences({ relativeBlockNumbers: !relative.relativeBlockNumbers }) },
      { label: "当前块号对齐", disabled: Boolean(numbering.blocks) || !visible || !relative.relativeBlockNumbers, run: () => {},
        children: (["left", "right"] as const).map(alignment => ({ label: alignment === "left" ? "左对齐" : "右对齐",
          checked: relative.relativeBlockNumberAlignment === alignment, keepOpen: true,
          run: () => saveBlockWorkspacePreferences({ relativeBlockNumberAlignment: alignment }) })) },
      foldGutterVisibilityAction("rendered", relative.renderedFoldGutter),
      { label: "默认折叠图标", group: "折叠", disabled: !relative.renderedFoldGutter || sharedOwned || saving || !onConfigChange, run: () => {},
        children: EDITOR_FOLD_PRESETS.map(preset => ({ label: preset.label, checked: editorFoldPreset(foldConfig) === preset.id,
          disabled: saving, keepOpen: true, run: () => { void save(editorFoldPresetPatch(preset.id)); } })) },
      { label: "代码块行号", group: "代码块", checked: preferences.lineNumbers === true, keepOpen: true,
        run: () => saveBlockWorkspacePreferences({ lineNumbers: preferences.lineNumbers !== true }) },
    ]} />}
    {error && <WorkspaceDialog title="显示设置保存失败" onClose={() => setError("")}><p role="alert">{error}</p></WorkspaceDialog>}
  </>;
}
