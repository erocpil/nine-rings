import {
  DEFAULT_EDITOR_FOLD_ICONS,
  outlineFoldStyle,
  type EditorFoldIconConfig,
} from "../lib/editor-fold-icons";
import { EditorFoldIcon, EditorFoldIconContext } from "./EditorFoldIcon";

export function SettingsFoldIcons({
  config,
  onChange,
}: {
  config: EditorFoldIconConfig;
  onChange: (partial: Partial<EditorFoldIconConfig>) => void;
}) {
  return (
    <div className="settings-fold-icons">
      <select
        className="settings-input"
        aria-label="折叠标识样式"
        value={config.editor_fold_icon_style ?? "chevron"}
        onChange={(event) => {
          const style = event.target.value;
          if (style === "chevron" || style === "triangle" || style === "custom")
            onChange({ editor_fold_icon_style: style });
        }}
      >
        <option value="chevron">线条箭头（默认）</option>
        <option value="triangle">实心三角（原版）</option>
        <option value="custom">自定义符号</option>
      </select>
      <label>
        章节目录折叠标识
        <select className="settings-input" aria-label="章节目录折叠标识" value={outlineFoldStyle(config)} onChange={event => {
          const style = event.target.value;
          if (style === "triangle" || style === "chevron" || style === "inherit") onChange({ editor_outline_fold_icon_style: style });
        }}>
          <option value="triangle">小三角（默认）</option>
          <option value="chevron">线条箭头</option>
          <option value="inherit">跟随正文折叠标识</option>
        </select>
      </label>
      {config.editor_fold_icon_style === "custom" && (
        <>
          <label>
            收起状态（点击展开）
            <input
              className="settings-input"
              aria-label="收起状态符号"
              maxLength={8}
              value={
                config.editor_fold_icon_collapsed ??
                DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_collapsed
              }
              onChange={(event) =>
                onChange({
                  editor_fold_icon_collapsed: Array.from(event.target.value)
                    .slice(0, 4)
                    .join(""),
                })
              }
            />
          </label>
          <label>
            展开状态（点击收起）
            <input
              className="settings-input"
              aria-label="展开状态符号"
              maxLength={8}
              value={
                config.editor_fold_icon_expanded ??
                DEFAULT_EDITOR_FOLD_ICONS.editor_fold_icon_expanded
              }
              onChange={(event) =>
                onChange({
                  editor_fold_icon_expanded: Array.from(event.target.value)
                    .slice(0, 4)
                    .join(""),
                })
              }
            />
          </label>
          <div className="settings-hint">
            建议使用单个符号，最多 4
            个字符；留空时使用原版三角。不改变文档树、设置及工具栏的箭头。
          </div>
        </>
      )}
      <EditorFoldIconContext.Provider value={config}>
        <div className="settings-fold-preview" aria-label="折叠标识预览">
          <span>
            收起 <EditorFoldIcon expanded={false} />
          </span>
          <span>
            展开 <EditorFoldIcon expanded />
          </span>
        </div>
      </EditorFoldIconContext.Provider>
    </div>
  );
}
