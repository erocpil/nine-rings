import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Quick Capture 迷你输入窗
 *
 * Ctrl+Shift+N 唤起，输入内容后 Enter 保存为便签，Esc 关闭。
 * 窗口本身由 Rust 侧 toggle_quick_capture 命令管理生命周期。
 */
export default function QuickCapture() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 窗口每次显示时聚焦输入框
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const content = text.trim();
    if (!content) {
      await getCurrentWindow().hide();
      return;
    }

    // 第一行作为标题，其余为正文（纯文本）
    const lines = content.split("\n");
    const title = lines[0].slice(0, 80);
    const body = lines.length > 1 ? lines.slice(1).join("\n") : "";

    try {
      await invoke("create_note", {
        data: {
          title,
          content: JSON.stringify({ ops: [{ insert: body }] }),
          date: new Date().toISOString().slice(0, 10),
          tags: [],
          pinned: false,
          sort_order: 0,
        },
      });
      // 通知主窗口刷新列表
      await getCurrentWindow().emit("quick-capture-created");
    } catch (e) {
      console.error("[QuickCapture] create_note failed:", e);
    } finally {
      setText("");
      await getCurrentWindow().hide();
    }
  }, [text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        setText("");
        getCurrentWindow().hide();
      }
    },
    [submit],
  );

  return (
    <div className="qc-container">
      <div className="qc-drag-handle">Quick Capture</div>
      <textarea
        ref={textareaRef}
        className="qc-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="记点什么… Enter 保存  Esc 取消"
        autoFocus
      />
      <div className="qc-footer">
        <span className="qc-hint">Enter 保存 · Esc 取消 · Shift+Enter 换行</span>
        <button className="qc-submit" onClick={submit}>
          保存
        </button>
      </div>
    </div>
  );
}
