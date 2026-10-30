import { useState } from "react";
import { sourceCommands, sourceShortcutSettings, saveSourceShortcuts } from "../lib/source-navigation-shortcuts";
export function SettingsSourceShortcuts() {
  const [settings, setSettings] = useState(sourceShortcutSettings);
  const [message, setMessage] = useState("");
  const update = (id: string, key: string) => {
    if (key === "Alt-F4") { setMessage("Alt+F4 保留给系统关闭窗口。"); return; }
    if (key && Object.entries(settings).some(([other, value]) => other !== id && value === key)) { setMessage("该组合已用于另一项源码操作，请先清除原绑定。"); return; }
    const next = { ...settings, [id]: key };
    try { saveSourceShortcuts(next); setSettings(next); setMessage("已更新"); } catch { setMessage("无法保存源码快捷键，请检查本地存储。"); }
  };
  return <section className="settings-source-shortcuts"><h3>源码导航与选择</h3>
    <p className="settings-desc">仅作用于源码编辑区，支持只读。为避免占用普通输入与 Vim 按键，自定义组合使用 Alt+F1～F12，可加 Shift；配对跳转也可使用默认 Cmd/Ctrl+Shift+反斜线。本机设置即时生效。</p>
    <div className="settings-source-shortcut-grid">{sourceCommands.map(command => <label key={command.id}>{command.label}<select aria-label={`${command.label}快捷键`} value={settings[command.id]} onChange={event => update(command.id, event.target.value)}>
      <option value="">未绑定</option>
      {command.id === "bracket" && <option value={"Mod-Shift-\\"}>Cmd/Ctrl+Shift+反斜线</option>}
      {[false, true].flatMap(shift => Array.from({ length: 12 }, (_, index) => { const key = `Alt-${shift ? "Shift-" : ""}F${index + 1}`; return <option disabled={key === "Alt-F4"} key={key} value={key}>{key.replace(/-/g, "+")}</option>; }))}
    </select></label>)}</div>
    <p className="settings-desc" role="status">{message}</p>
    <button type="button" className="menu-btn" onClick={() => { const next = Object.fromEntries(sourceCommands.map(command => [command.id, command.key])); try { saveSourceShortcuts(next); setSettings(next); setMessage("已恢复默认"); } catch { setMessage("无法保存源码快捷键。"); } }}>恢复源码快捷键默认值</button>
  </section>;
}
