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

  // 移除旧主题类
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
 */
export default function QuickCapture() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── 1. 加载配置 + 应用主题 ──
  useEffect(() => {
    console.log("[QC] 窗口挂载 — 加载配置...");
    api.config.get().then((c) => {
      console.log(`[QC] 配置加载完成: theme=${c.theme} font_size=${c.note_font_size}`);
      applyQCTheme(c.theme);
      setLoading(false);
    }).catch((e) => {
      console.error("[QC] 配置加载失败:", e);
      // 回退：用浅色主题
      applyQCTheme("light");
      setLoading(false);
    });
  }, []);

  // ── 2. 窗口显示时聚焦输入框 ──
  useEffect(() => {
    if (!loading) {
      console.log("[QC] 聚焦输入框");
      textareaRef.current?.focus();
    }
  }, [loading]);

  // ── 3. 提交 ──
  const submit = useCallback(async () => {
    console.log(`[QC] 提交 — 原始文本长度: ${text.length}`);
    const content = text.trim();
    if (!content) {
      console.log("[QC] 空内容，关闭窗口");
      await getCurrentWindow().hide();
      return;
    }

    const lines = content.split("\n");
    const title = lines[0].slice(0, 80);
    const body = lines.length > 1 ? lines.slice(1).join("\n") : "";
    console.log(`[QC] title="${title}" body_len=${body.length}`);

    try {
      console.log("[QC] 调用 create_note...");
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
      console.log("[QC] create_note 成功，通知主窗口刷新");
      await getCurrentWindow().emit("quick-capture-created");
    } catch (e) {
      console.error("[QC] create_note 失败:", e);
    } finally {
      setText("");
      console.log("[QC] 隐藏窗口");
      await getCurrentWindow().hide();
    }
  }, [text]);

  // ── 4. 键盘处理 ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        console.log("[QC] Enter → 提交");
        submit();
      } else if (e.key === "Escape") {
        console.log("[QC] Esc → 取消");
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
