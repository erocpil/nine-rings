import { useRef, useState, type RefObject } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { ToolbarIcon } from "./ToolbarIcon";
import { browserShortcutCommands, browserShortcutFromEvent, defaultBrowserShortcuts, displayBrowserShortcut, validateBrowserShortcuts, type BrowserShortcutId, type BrowserShortcuts, type ShortcutReservation } from "../lib/local-files/browser-shortcuts";

export function FileBrowserShortcuts({ value, mac, reservations, onSave, onClose, restoreFocusRef }: {
  value: BrowserShortcuts; mac: boolean; reservations: readonly ShortcutReservation[];
  onSave(value: BrowserShortcuts): void; onClose(): void; restoreFocusRef: RefObject<HTMLButtonElement>;
}) {
  const [draft, setDraft] = useState(value);
  const [recording, setRecording] = useState<BrowserShortcutId | null>(null);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const defaults = defaultBrowserShortcuts();
  const validationError = validateBrowserShortcuts(draft, mac, reservations);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const apply = (next: BrowserShortcuts) => {
    const error = validateBrowserShortcuts(next, mac, reservations);
    if (error) { setMessage(error); return; }
    setDraft(next); setRecording(null); setMessage("");
  };
  return <WorkspaceDialog title="文件浏览快捷键" onClose={onClose} restoreFocusRef={restoreFocusRef} previewBackdrop>
    <div className="file-browser-shortcut-settings">
      <p>文件操作和预览仅在文件列表获得焦点时生效；路径与过滤在当前目录栏生效。重新录制会替换该命令的原有按键。</p>
      {(message || validationError) && <p role="alert">{message || validationError}</p>}
      <div className="file-browser-shortcut-groups">
        {[...new Set(browserShortcutCommands.map(command => command.group))].map(group => <fieldset key={group}><legend>{group}</legend>
          {browserShortcutCommands.filter(command => command.group === group).map(command => <div key={command.id} className="file-browser-shortcut-row">
            <span title={command.scope}>{command.label}</span>
            {recording === command.id ? <input ref={input} className="settings-input" autoFocus readOnly value="请按下组合键…" aria-label={`录制${command.label}快捷键`} onBlur={() => setRecording(null)} onKeyDown={event => {
              event.stopPropagation();
              if (event.key === "Tab") { setRecording(null); return; }
              event.preventDefault();
              if (event.key === "Escape") { setRecording(null); setMessage(""); return; }
              if (event.repeat || event.nativeEvent.isComposing) return;
              const shortcut = browserShortcutFromEvent(event, mac);
              if (shortcut) apply({ ...draft, [command.id]: [shortcut] });
            }} /> : <button type="button" aria-label={`修改${command.label}快捷键`} onClick={() => { setMessage(""); setRecording(command.id); }}><kbd>{draft[command.id].map(key => displayBrowserShortcut(key, mac)).join(" / ") || "未设置"}</kbd></button>}
            <button type="button" className="btn-icon" title={`禁用${command.label}快捷键`} aria-label={`禁用${command.label}快捷键`} disabled={!draft[command.id].length} onClick={() => { setDraft({ ...draft, [command.id]: [] }); setMessage(""); }}><ToolbarIcon name="close" /></button>
            <button type="button" className="btn-icon" title={`恢复${command.label}默认快捷键`} aria-label={`恢复${command.label}默认快捷键`} disabled={JSON.stringify(draft[command.id]) === JSON.stringify(defaults[command.id])} onClick={() => apply({ ...draft, [command.id]: defaults[command.id] })}><ToolbarIcon name="undo" /></button>
          </div>)}
        </fieldset>)}
      </div>
      <details><summary>固定导航与选择按键</summary><p>Tab 切换两栏；方向键、Home / End、Page Up / Down 移动；Enter 打开；Insert 切换选择；{mac ? "⌘" : "Ctrl"}+A 全选。Esc 关闭当前弹层或取消录制。输入框和编辑器保留自己的快捷键。</p></details>
      <footer><button type="button" onClick={() => apply(defaults)}>恢复全部默认</button><button type="button" onClick={onClose}>取消</button><button type="button" disabled={!dirty || recording !== null || Boolean(validationError)} onClick={() => { try { onSave(draft); onClose(); } catch (error) { setMessage(String(error)); } }}>保存快捷键</button></footer>
    </div>
  </WorkspaceDialog>;
}
