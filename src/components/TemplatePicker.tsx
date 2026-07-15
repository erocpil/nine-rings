import { useEffect, useState, useRef } from "react";
import { templateStore, type Template } from "../lib/storage/template-store";

interface TemplatePickerProps {
  /** 选中模板后回调 */
  onSelect: (template: Template) => void;
  /** 点击"空白"后回调（不应用任何模板元数据） */
  onBlank: () => void;
  /** 点击外部/取消 */
  onClose: () => void;
  /** 定位锚点（相对视口的 rect），popover 展示在此位置附近 */
  anchorRect?: DOMRect | null;
}

export function TemplatePicker({ onSelect, onBlank, onClose, anchorRect }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 播种 + 加载
    templateStore.seedBuiltinTemplates().then(() => {
      return templateStore.listTemplates();
    }).then((list) => {
      setTemplates(list);
    }).catch((err) => {
      console.error("Failed to load templates:", err);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟绑定，避免触发 click 时立即关闭
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // 计算 popover 位置
  const style: React.CSSProperties = anchorRect ? {
    position: "fixed",
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 320),
    left: Math.min(anchorRect.left, window.innerWidth - 260),
  } : {};

  return (
    <div className="template-popover" ref={popoverRef} style={style}>
      <div className="template-popover-header">
        <span>从模板创建</span>
        <button className="btn-icon template-popover-close" onClick={onClose}>✕</button>
      </div>

      <div className="template-list">
        {/* 空白笔记 — 始终在第一项 */}
        <button
          className="template-item template-item-blank"
          onClick={() => { onBlank(); onClose(); }}
        >
          <span className="template-item-icon">📝</span>
          <span className="template-item-info">
            <span className="template-item-name">空白笔记</span>
            <span className="template-item-desc">无预设元数据</span>
          </span>
        </button>

        {loading ? (
          <div className="template-loading">加载中...</div>
        ) : (
          templates.map((t) => (
            <button
              key={t.id}
              className="template-item"
              onClick={() => { onSelect(t); onClose(); }}
            >
              <span className="template-item-icon">
                {t.id === "builtin-meeting" ? "📋" :
                 t.id === "builtin-reading" ? "📖" :
                 t.id === "builtin-project" ? "🚀" :
                 t.id === "builtin-idea" ? "💡" :
                 t.id === "builtin-todo" ? "✅" :
                 t.id === "builtin-knowledge" ? "🧠" :
                 t.id === "builtin-weekly" ? "📊" :
                 "📄"}
              </span>
              <span className="template-item-info">
                <span className="template-item-name">{t.name}</span>
                <span className="template-item-desc">
                  {t.tags.length > 0 && (
                    <span className="template-item-tags">
                      {t.tags.map((tag) => (
                        <span key={tag} className="template-item-tag">{tag}</span>
                      ))}
                    </span>
                  )}
                  {t.description && !t.tags.length && t.description}
                </span>
              </span>
            </button>
          ))
        )}

        {!loading && templates.length === 0 && (
          <div className="template-empty">暂无模板</div>
        )}
      </div>

      <div className="template-popover-footer">
        <span className="template-hint">模板仅预设元数据（标签、路径、类型），不影响内容</span>
      </div>
    </div>
  );
}
