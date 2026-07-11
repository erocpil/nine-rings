import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";

/** 将主题名映射为 CSS class 并应用到 <html> */
function applyQCTheme(theme: string) {
  const root = document.documentElement;

  if (theme === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    root.classList.add(mq.matches ? "theme-dark" : "theme-light");
    return;
  }

  root.classList.remove(
    "theme-light", "theme-dark", "theme-fu", "theme-grace",
    "theme-sui", "theme-zhi", "theme-azure", "theme-azure-dark",
  );

  if (theme === "light") root.classList.add("theme-light");
  else if (theme === "dark") root.classList.add("theme-dark");
  else if (theme === "fu") root.classList.add("theme-fu");
  else if (theme === "grace") root.classList.add("theme-grace");
  else if (theme === "sui") root.classList.add("theme-sui");
  else if (theme === "zhi") root.classList.add("theme-zhi");
  else if (theme === "azure") root.classList.add("theme-azure");
  else if (theme === "azure-dark") root.classList.add("theme-azure-dark");
}

/**
 * Quick Capture 迷你输入窗
 *
 * Ctrl+Alt+N 唤起，输入内容后 Enter 保存为便签，Esc 关闭。
 * 窗口本身由 Rust 侧 toggle_quick_capture 命令管理生命周期。
 *
 * 内容写入统一走 api.notes.create()——与主窗口共享同一存储路径：
 *   Tauri 桌面 → invoke("create_note") → Rust SQLite
 *   Web/PWA    → IndexedDB adapter
 */
export default function QuickCapture() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── 1. 加载配置 + 应用主题 ──
  useEffect(() => {
    console.log("[QC] ┌─ 窗口挂载 — 加载配置...");
    api.config.get().then((c) => {
      console.log(`[QC] ├─ 配置加载完成: theme=${c.theme}`);
      applyQCTheme(c.theme);
      setLoading(false);
      console.log("[QC] └─ 主题已应用");
    }).catch((e) => {
      console.error("[QC] ✗ 配置加载失败:", e);
      applyQCTheme("light");
      setLoading(false);
    });
  }, []);

  // ── 2. 窗口显示时聚焦输入框 ──
  useEffect(() => {
    if (!loading) {
      textareaRef.current?.focus();
    }
  }, [loading]);

  // ── 3. 提交：创建笔记（Tauri）或保存到 IndexedDB（Web）──
  const submit = useCallback(async () => {
    const content = text.trim();
    if (!content) {
      await getCurrentWindow().hide();
      return;
    }

    const lines = content.split("\n");
    const title = lines[0].slice(0, 80);
    const body = lines.length > 1 ? lines.slice(1).join("\n") : "";
    const today = new Date().toISOString().slice(0, 10);

    console.log(`[QC] ├─ 提交: date=${today} title="${title}" bodyLen=${body.length}`);
    setSubmitting(true);

    try {
      // 统一走 api.notes.create()——跨平台（Tauri IPC / IndexedDB）
      await api.notes.create({
        date: today,
        title,
        content: { ops: [{ insert: body || "\n" }] },
        tags: [],
        pinned: false,
      });
      console.log("[QC] ├─ api.notes.create ✓ 成功");

      // Tauri 桌面：跨窗口通知主窗口刷新
      // @ts-ignore
      if (typeof window !== "undefined" && window.__TAURI__) {
        try {
          await invoke("emit_to_main", { event: "quick-capture-created" });
          console.log("[QC] ├─ emit_to_main ✓ 已通知主窗口");
        } catch (e) {
          console.warn("[QC] ⚠ emit_to_main 失败（非致命）:", e);
        }
      }
    } catch (e) {
      console.error("[QC] ✗ 创建笔记失败:", e);
    } finally {
      setText("");
      setSubmitting(false);
      await getCurrentWindow().hide();
    }
  }, [text]);

  // ── 4. 键盘处理 ──
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

  if (loading) {
    return (
      <div className="qc-container">
        <div className="qc-drag-handle">Quick Capture</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
          加载中...
        </div>
      </div>
    );
  }

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
        disabled={submitting}
      />
      <div className="qc-footer">
        <span className="qc-hint">
          {submitting ? "保存中…" : "Enter 保存 · Esc 取消 · Shift+Enter 换行"}
        </span>
        <button className="qc-submit" onClick={submit} disabled={submitting}>
          {submitting ? "..." : "保存"}
        </button>
      </div>
    </div>
  );
}
