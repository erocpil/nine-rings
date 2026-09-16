import React, { useState } from "react";
import type { AppConfig } from "../types/models";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../types/models";
import { isWorkspaceShortcutEnabled } from "../lib/workspace-features";
import {
  isDocumentFindShortcut,
  isEditorLineJumpShortcut,
} from "../lib/shortcuts";

// ── 快捷键配置 ──

export function HotkeyConfig({
  config,
  onUpdate,
}: {
  config: AppConfig;
  onUpdate: (hk: Record<string, string>) => void;
}) {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const startRecord = (id: string) => {
    setRecordingError(null);
    setRecordingId(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (recordingId === null) return;
    if (e.key === "Escape") {
      setRecordingId(null);
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(key);

    const shortcut = parts.join("+");
    if (isDocumentFindShortcut(shortcut)) {
      setRecordingError(
        "Ctrl+F 已保留给 Vim 翻页，Cmd+F 与 Alt+F 已保留给当前文档查找。",
      );
      setRecordingId(null);
      return;
    }
    if (isEditorLineJumpShortcut(shortcut)) {
      setRecordingError("Alt+G 已保留给当前文档跳转行号，请使用其他组合键。");
      setRecordingId(null);
      return;
    }
    const updated = { ...config.hotkeys, [recordingId]: shortcut };
    onUpdate(updated);
    setRecordingId(null);
  };

  const resetHotkey = (id: string) => {
    const updated = { ...config.hotkeys, [id]: DEFAULT_HOTKEYS[id] };
    onUpdate(updated);
  };

  return (
    <div className="hotkey-list">
      <div className="hotkey-reserved-note">
        Cmd+F、Alt+F：当前文档查找；Alt+G：跳转行号；Vim Normal/Visual
        会优先接管 Ctrl 导航键，格式快捷键只在 Insert 生效
      </div>
      {recordingError && (
        <div className="hotkey-recording-error" role="status">
          {recordingError}
        </div>
      )}
      {Object.entries(HOTKEY_LABELS)
        .filter(([id]) => isWorkspaceShortcutEnabled(id))
        .map(([id, label]) => {
          const current = config.hotkeys?.[id] || DEFAULT_HOTKEYS[id];
          const isRecording = recordingId === id;

          return (
            <div key={id} className="hotkey-row">
              <span className="hotkey-label">{label}</span>
              {isRecording ? (
                <input
                  className={`hotkey-input recording`}
                  value="按下新快捷键…"
                  readOnly
                  onKeyDown={handleKeyDown}
                  onBlur={() => setRecordingId(null)}
                  autoFocus
                />
              ) : (
                <button
                  className="hotkey-btn"
                  onClick={() => startRecord(id)}
                  title="点击修改快捷键"
                >
                  <kbd>{formatShortcut(current)}</kbd>
                </button>
              )}
              <button
                className="hotkey-reset"
                onClick={() => resetHotkey(id)}
                title="恢复默认"
                disabled={current === DEFAULT_HOTKEYS[id]}
              >
                ↺
              </button>
            </div>
          );
        })}
    </div>
  );
}

function formatShortcut(s: string): string {
  return s
    .replace(
      "CommandOrControl",
      navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
    )
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace("Shift", navigator.platform.includes("Mac") ? "⇧" : "Shift")
    .replace(/\+/g, " + ");
}
