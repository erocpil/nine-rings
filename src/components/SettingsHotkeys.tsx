import React, { useState } from "react";
import type { AppConfig } from "../types/models";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS } from "../types/models";
import { isWorkspaceShortcutEnabled } from "../lib/workspace-features";
import { isTauriRuntime } from "../lib/runtime";
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
  const mac = /Mac/i.test(navigator.platform);

  const startRecord = (id: string) => {
    setRecordingError(null);
    setRecordingId(id);
  };
  const conflictFor = (id: string, shortcut: string) => {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/\s+/g, "")
        .split("+")
        .map((part) =>
          part === "commandorcontrol"
            ? mac
              ? "meta"
              : "control"
            : /^(ctrl|control)$/.test(part)
              ? "control"
              : /^(command|cmd|meta)$/.test(part)
                ? "meta"
                : part,
        )
        .sort()
        .join("+");
    return (
      shortcut &&
      Object.entries(HOTKEY_LABELS).find(
        ([other]) =>
          other !== id &&
          isWorkspaceShortcutEnabled(other) &&
          normalize(
            other === "show_window"
              ? DEFAULT_HOTKEYS[other]
              : (config.hotkeys?.[other] ?? DEFAULT_HOTKEYS[other]),
          ) === normalize(shortcut),
      )
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (recordingId === null) return;
    e.stopPropagation();
    if (e.key === "Tab") {
      setRecordingId(null);
      return;
    }
    e.preventDefault();
    if (e.nativeEvent.isComposing || e.repeat) return;
    if (e.key === "Escape") {
      setRecordingId(null);
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    if (
      (!e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !/^F([1-9]|1\d|2[0-4])$/.test(e.key)) ||
      (e.ctrlKey && e.metaKey)
    ) {
      setRecordingError(
        "请使用 Ctrl / Command、Alt 组合键或功能键，避免占用普通输入；Ctrl 与 Command 请只选一个。",
      );
      return;
    }

    const parts: string[] = [];
    if (e.ctrlKey) parts.push(mac ? "Control" : "CommandOrControl");
    if (e.metaKey) parts.push(mac ? "CommandOrControl" : "Super");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const punctuation: Record<string, string> = {
      Comma: ",",
      Period: ".",
      Slash: "/",
      Semicolon: ";",
      Quote: "'",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Backquote: "`",
      Space: "Space",
    };
    const key = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3)
      : /^Digit\d$/.test(e.code)
        ? e.code.slice(5)
        : (punctuation[e.code] ??
          (e.key.length === 1 ? e.key.toUpperCase() : e.key));
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
    const conflict = conflictFor(recordingId, shortcut);
    if (conflict) {
      setRecordingError(`此组合已用于“${conflict[1]}”，请选择其他组合键。`);
      setRecordingId(null);
      return;
    }
    setRecordingError(null);
    const updated = { ...config.hotkeys, [recordingId]: shortcut };
    onUpdate(updated);
    setRecordingId(null);
  };

  const resetHotkey = (id: string) => {
    const conflict = conflictFor(id, DEFAULT_HOTKEYS[id]);
    if (conflict) {
      setRecordingError(`默认组合已用于“${conflict[1]}”，请先修改该项。`);
      return;
    }
    setRecordingError(null);
    const updated = { ...config.hotkeys, [id]: DEFAULT_HOTKEYS[id] };
    onUpdate(updated);
  };

  return (
    <div className="hotkey-list">
      <div className="hotkey-reserved-note">
        {!isTauriRuntime() && (
          <p>
            以下绑定用于 Tauri 桌面版，可随备份迁移。Web 版仍使用 Alt+E
            搜索、Alt+, 打开设置；无法用全局热键唤起浏览器窗口。
          </p>
        )}
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
          const fixed = id === "show_window";
          const current = fixed
            ? DEFAULT_HOTKEYS[id]
            : (config.hotkeys?.[id] ?? DEFAULT_HOTKEYS[id]);
          const isRecording = recordingId === id;

          return (
            <div key={id} className="hotkey-row">
              <span className="hotkey-label">{label}</span>
              {fixed ? (
                <span className="hotkey-fixed">
                  <kbd>{formatShortcut(current)}</kbd>
                  <small>桌面固定快捷键</small>
                </span>
              ) : (
                <>
                  {isRecording ? (
                    <input
                      className={`hotkey-input recording`}
                      value="按下新快捷键…"
                      readOnly
                      aria-label={`录制${label}快捷键`}
                      onKeyDown={handleKeyDown}
                      onBlur={() => setRecordingId(null)}
                      autoFocus
                    />
                  ) : (
                    <button
                      className="hotkey-btn"
                      onClick={() => startRecord(id)}
                      title="点击修改快捷键"
                      aria-label={`修改${label}快捷键`}
                    >
                      <kbd>{current ? formatShortcut(current) : "未设置"}</kbd>
                    </button>
                  )}
                  <button
                    className="hotkey-reset"
                    onClick={() => resetHotkey(id)}
                    title="恢复默认"
                    aria-label={`恢复${label}默认快捷键`}
                    disabled={current === DEFAULT_HOTKEYS[id]}
                  >
                    ↺
                  </button>
                </>
              )}
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
    .replace("Control", "Ctrl")
    .replace("Super", "Win")
    .replace(/\+/g, " + ");
}
