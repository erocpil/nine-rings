import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { blockWorkspacePreferences } from "../lib/block-display-settings";
import { formatSource, sourceFormatChange, sourceFormatSettings, saveSourceFormatSettings, sourceFormatStyle, SOURCE_FORMAT_STYLES, type SourceFormatSettings } from "../lib/source-formatting";
import { EditorStatusSelect } from "./EditorStatusSelect";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { ToolbarIcon } from "./ToolbarIcon";

export function SourceFormattingControls({ editorRef, language, readonly, active, hasSelection, onMessage }: {
  editorRef: MutableRefObject<EditorView | null>; language: string; readonly: boolean; active: boolean;
  hasSelection: boolean; onMessage: (message: string) => void;
}) {
  const [settings, setSettings] = useState(sourceFormatSettings);
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [configError, setConfigError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const latest = useRef({ language, readonly, active });
  latest.current = { language, readonly, active };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const supported = language === "c" || language === "cpp";
  const update = (next: SourceFormatSettings) => { setSettings(next); saveSourceFormatSettings(next); };
  const format = async (scope: "document" | "selection") => {
    const editor = editorRef.current;
    if (!editor || !active || !supported || readonly || editor.state.readOnly || editor.composing || busyRef.current) return;
    const state = editor.state;
    const selection = state.selection.main;
    if (scope === "selection" && selection.empty) return;
    if (scope === "selection" && state.selection.ranges.length > 1) { onMessage("请使用一个连续选区执行代码格式化。"); return; }
    busyRef.current = true;
    setBusy(true);
    onMessage("正在本机整理代码…");
    const current = () => mounted.current && editorRef.current === editor && latest.current.active
      && latest.current.language === language && !latest.current.readonly && !editor.state.readOnly
      && !editor.composing && editor.state.doc === state.doc && editor.state.selection.eq(state.selection);
    try {
      const prefs = blockWorkspacePreferences();
      const result = await formatSource({ source: state.doc.toString(), language,
        style: sourceFormatStyle(settings, prefs.tabSize ?? 4, prefs.sourceIndentStyle !== "spaces"),
        ...(scope === "selection" ? { range: { from: selection.from, to: selection.to } } : {}),
      });
      const change = await sourceFormatChange(state, result);
      if (!current()) {
        if (mounted.current && latest.current.active) onMessage("编辑状态已变化，已丢弃格式化结果，请重新执行。");
        return;
      }
      if (change?.changes) {
        const changes = state.changes(change.changes);
        const snapshot = editor.scrollSnapshot().map(changes);
        editor.dispatch({ ...change, ...(snapshot ? { effects: snapshot } : {}) });
      }
      editor.focus();
      onMessage(change ? scope === "document" ? "已格式化全文" : "已格式化选区（可能扩展至完整语法结构）" : "代码已符合当前格式。" );
    } catch (error) {
      if (mounted.current && latest.current.active) onMessage(`格式化失败：${error instanceof Error ? error.message : String(error)}；原文未修改。`);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useNativeMenuActions({
    "source.formatDocument": { run: () => format("document"), enabled: supported && !readonly && !busy },
    "source.formatSelection": { run: () => format("selection"), enabled: supported && !readonly && !busy && hasSelection },
  }, active);
  if (!supported) return null;
  return <>
    <button type="button" title="格式化选区 · clang-format" aria-label="格式化选区" disabled={readonly || busy || !hasSelection}
      onMouseDown={event => event.preventDefault()} onClick={() => void format("selection")}><ToolbarIcon name="formatSelection" /></button>
    <button type="button" title="格式化全文 · clang-format" aria-label="格式化全文" aria-busy={busy} disabled={readonly || busy}
      onMouseDown={event => event.preventDefault()} onClick={() => void format("document")}><ToolbarIcon name="formatDocument" /></button>
    <EditorStatusSelect label="代码格式风格" title="代码格式风格；预设跟随 Tab 设置，自定义配置优先" value={settings.style}
      options={[...SOURCE_FORMAT_STYLES.map(value => ({ value, label: value })), { value: "custom", label: "自定义 .clang-format" }]}
      onChange={value => {
        if (value === "custom") { setDraft(settings.custom); setConfigError(""); setConfigOpen(true); }
        else update({ ...settings, style: value as SourceFormatSettings["style"] });
      }} />
    {configOpen && <WorkspaceDialog title="代码格式配置" onClose={() => setConfigOpen(false)}>
      <form className="source-format-config" onSubmit={event => { event.preventDefault(); update({ style: "custom", custom: draft }); setConfigOpen(false); }}>
        <p>粘贴或导入 .clang-format（YAML / JSON）。配置优先于 Tab Size 与 Tab/空格偏好，仅保存在本机。</p>
        <label>选择 .clang-format 文件<input type="file" aria-label="导入格式配置" onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 65536) { setConfigError("格式配置不能超过 64 KiB。"); return; }
          try { setDraft(await file.text()); setConfigError(""); } catch { setConfigError("读取格式配置失败。"); }
        }} /></label>
        <textarea aria-label=".clang-format 配置" value={draft} maxLength={65536} spellCheck={false} onChange={event => setDraft(event.target.value)} placeholder={'BasedOnStyle: LLVM\nIndentWidth: 4\nColumnLimit: 100'} />
        {configError && <p role="alert">{configError}</p>}
        <p>手动执行；选区格式化可能连同相邻语法结构调整。配置无效时保留原文并报告错误。</p>
        <div className="image-dialog-actions"><button className="menu-btn" type="button" onClick={() => setConfigOpen(false)}>取消</button>
          <button className="menu-btn active" type="submit" disabled={!draft.trim()}>使用此配置</button></div>
      </form>
    </WorkspaceDialog>}
  </>;
}
