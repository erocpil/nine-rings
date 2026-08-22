import React, { useEffect } from "react";
import type { AppConfig } from "../types/models";
import { DEFAULT_EDITOR_APPEARANCE, editorAppearanceVariables } from "../lib/editor-appearance";

interface Props {
  config: AppConfig;
  onClose: () => void;
  onApply: () => void;
  dirty: boolean;
  onUpdate: (partial: Partial<AppConfig>) => void;
}

export function EditorAppearancePanel({ config, onClose, onApply, dirty, onUpdate }: Props) {
  const variables = editorAppearanceVariables(config) as React.CSSProperties;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="editor-appearance-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-appearance-title"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="editor-appearance-panel" onClick={(event) => event.stopPropagation()}>
        <header className="editor-appearance-header">
          <div>
            <div className="editor-appearance-kicker">编辑器</div>
            <h2 id="editor-appearance-title">排版设置</h2>
            <p>调整只影响阅读和编辑外观，不会修改文档内容或 Markdown 导出结果。</p>
          </div>
          <button className="settings-close" type="button" onClick={onClose} aria-label="关闭编辑器排版">✕</button>
        </header>

        <div className="editor-appearance-workspace">
          <div className="editor-appearance-controls">
            <AppearanceField label="正文字体" desc="选择编辑器正文的字体组合">
              <select
                className="settings-input editor-appearance-select"
                aria-label="正文字体"
                value={config.editor_font_family}
                onChange={(event) => onUpdate({ editor_font_family: event.target.value as AppConfig["editor_font_family"] })}
              >
                <option value="system">系统默认</option>
                <option value="sans">无衬线</option>
                <option value="serif">衬线 / 宋体</option>
                <option value="monospace">等宽字体</option>
              </select>
            </AppearanceField>

            <div className="editor-appearance-control-grid">
              <AppearanceField label="正文与标题字号" desc="同步调整文档标题、正文及各级标题">
                <AppearanceStepper label="正文与标题字号" value={config.note_font_size} minimum={12} maximum={32} step={1} unit="px" onChange={(value) => onUpdate({ note_font_size: value })} />
              </AppearanceField>
              <AppearanceField label="行距" desc="正文各行之间的垂直距离">
                <AppearanceStepper label="行距" value={config.editor_line_height} minimum={1.2} maximum={2.2} step={0.1} onChange={(value) => onUpdate({ editor_line_height: value })} />
              </AppearanceField>
              <AppearanceField label="正文块间距" desc="控制相邻顶层正文段落之间的距离">
                <AppearanceStepper label="正文块间距" value={config.editor_block_spacing} minimum={0} maximum={3} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_block_spacing: value })} />
              </AppearanceField>
              <AppearanceField label="段落首行缩进" desc="仅应用于顶层正文段落">
                <AppearanceStepper label="段落首行缩进" value={config.editor_paragraph_indent} minimum={0} maximum={2} step={0.5} unit="em" onChange={(value) => onUpdate({ editor_paragraph_indent: value })} />
              </AppearanceField>
              <AppearanceField label="标题上间距" desc="控制各级标题与前一块的距离">
                <AppearanceStepper label="标题上间距" value={config.editor_heading_margin_top} minimum={0} maximum={2} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_heading_margin_top: value })} />
              </AppearanceField>
              <AppearanceField label="标题下间距" desc="控制各级标题与后一块的距离">
                <AppearanceStepper label="标题下间距" value={config.editor_heading_margin_bottom} minimum={0} maximum={1.5} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_heading_margin_bottom: value })} />
              </AppearanceField>
              <AppearanceField label="列表上间距" desc="控制顶层列表与前一块的距离">
                <AppearanceStepper label="列表上间距" value={config.editor_list_margin_top} minimum={0} maximum={2} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_list_margin_top: value })} />
              </AppearanceField>
              <AppearanceField label="列表下间距" desc="控制顶层列表与后一块的距离">
                <AppearanceStepper label="列表下间距" value={config.editor_list_margin_bottom} minimum={0} maximum={1.5} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_list_margin_bottom: value })} />
              </AppearanceField>
              <AppearanceField label="列表层级缩进" desc="两种列表同步调整；有序列表会额外预留编号宽度">
                <AppearanceStepper label="列表层级缩进" value={config.editor_list_indent} minimum={1} maximum={3} step={0.05} unit="em" onChange={(value) => onUpdate({ editor_list_indent: value })} />
              </AppearanceField>
              <AppearanceField label="标记文字间距" desc="同时控制圆点或编号与文字之间的距离">
                <AppearanceStepper label="标记文字间距" value={config.editor_list_marker_gap} minimum={0.1} maximum={0.8} step={0.1} unit="em" onChange={(value) => onUpdate({ editor_list_marker_gap: value })} />
              </AppearanceField>
              <AppearanceField label="引用块缩进" desc="控制引用竖线与正文的距离">
                <AppearanceStepper label="引用块缩进" value={config.editor_blockquote_indent} minimum={4} maximum={32} step={2} unit="px" onChange={(value) => onUpdate({ editor_blockquote_indent: value })} />
              </AppearanceField>
            </div>

            <AppearanceField label="搜索关键字颜色" desc="Alt+F、Cmd+F 和笔记搜索定位时的匹配背景色">
              <label className="settings-color-control">
                <input
                  type="color"
                  aria-label="搜索关键字颜色"
                  value={config.editor_search_highlight_color}
                  onChange={(event) => onUpdate({ editor_search_highlight_color: event.target.value })}
                />
                <span>{config.editor_search_highlight_color.toUpperCase()}</span>
              </label>
            </AppearanceField>

            <AppearanceField label="中英文自动间距" desc="在汉字与英文、数字之间增加视觉间距，不修改文档内容">
              <label className="settings-toggle editor-appearance-toggle">
                <input
                  type="checkbox"
                  aria-label="中英文自动间距"
                  checked={config.editor_cjk_spacing}
                  onChange={(event) => onUpdate({ editor_cjk_spacing: event.target.checked })}
                />
                <span>{config.editor_cjk_spacing ? "已开启" : "已关闭"}</span>
              </label>
            </AppearanceField>

            <button
              className="settings-btn-secondary editor-appearance-reset"
              type="button"
              onClick={() => onUpdate({ ...DEFAULT_EDITOR_APPEARANCE })}
            >恢复默认排版</button>
            <div className="editor-appearance-actions">
              <button className="settings-btn-secondary editor-appearance-cancel" type="button" onClick={onClose}>取消</button>
              <button
                className="settings-btn-primary editor-appearance-apply"
                type="button"
                disabled={!dirty}
                onClick={onApply}
              >
                应用到编辑器
              </button>
            </div>
          </div>

          <div className="editor-appearance-preview-pane">
            <div className="editor-appearance-preview-label">
              <span>实时预览</span>
              <small>{config.note_font_size}px · {config.editor_line_height.toFixed(1)} 行距</small>
            </div>
            <article className={`editor-appearance-preview editor-appearance-document ${config.editor_cjk_spacing ? "editor-auto-cjk-spacing" : ""}`} style={variables} aria-label="编辑器排版预览">
              <h1>把想法整理成可读的结构</h1>
              <p>Nine Rings支持Markdown编辑，排版不改变内容本身，却会直接影响阅读节奏。</p>
              <h2>清晰的层级</h2>
              <ul>
                <li>一级列表用于表达主要观点
                  <ul><li>二级列表展示缩进与圆点间距</li></ul>
                </li>
                <li>让相邻信息保持稳定的视觉关系</li>
              </ul>
              <ol>
                <li>有序列表使用相同的层级缩进
                  <ol><li>二级编号与无序列表保持一致</li></ol>
                </li>
                <li>调整时两种列表同步变化</li>
              </ol>
              <h3>紧凑的小节</h3>
              <p>标题上下间距会在这里实时呈现。</p>
              <p>相邻正文段落之间使用独立的正文块间距。</p>
              <p className="standalone-strong-label"><strong>概念标签</strong></p>
              <p>纯粗体标签后的正文沿用紧凑的标题下间距。</p>
              <blockquote>引用块缩进帮助补充说明与正文形成清楚的层次。</blockquote>
              <pre><code>const keep = "Readable layout";</code></pre>
              <hr />
              <p>代码块和引用块样式也会随着预览中的字号/行距同步变化。</p>
              <p>使用 <mark>Alt+F 搜索关键字</mark> 时，匹配内容会采用所选的高亮颜色。</p>
              <table>
                <thead><tr><th>项目</th><th>效果</th></tr></thead>
                <tbody><tr><td>字体与字号</td><td>决定页面的基本气质</td></tr><tr><td>行距与缩进</td><td>控制信息密度和阅读节奏</td></tr></tbody>
              </table>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearanceField({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="appearance-field">
      <div className="settings-label">{label}</div>
      <div className="settings-desc">{desc}</div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function AppearanceStepper({ label, value, minimum, maximum, step, unit = "", onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const decimals = String(step).split(".")[1]?.length ?? 0;
  const adjust = (direction: number) => {
    const next = Math.min(maximum, Math.max(minimum, value + direction * step));
    onChange(Number(next.toFixed(decimals)));
  };
  return (
    <div className="settings-stepper">
      <button type="button" aria-label={`减小${label}`} className="settings-step-btn" disabled={value <= minimum} onClick={() => adjust(-1)}>−</button>
      <span className="settings-value">{value.toFixed(decimals)}{unit}</span>
      <button type="button" aria-label={`增大${label}`} className="settings-step-btn" disabled={value >= maximum} onClick={() => adjust(1)}>+</button>
    </div>
  );
}
