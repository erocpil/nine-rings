import type { CSSProperties, ReactNode, RefObject } from "react";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import {
  statusDisplayStyle,
  type StatusItem,
} from "../lib/plugin-system/status-display";
import { NavigationButtons } from "./NavigationButtons";
import { ToolbarIcon } from "./ToolbarIcon";
import { DOCUMENT_LANGUAGE_OPTIONS } from "../lib/document-language";
type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";
export function EditorStatusBar({
  enabled,
  focusMode = false,
  label = "文档状态栏",
  className = "",
  saveStatus,
  block,
  position,
  positionRef,
  characters,
  words,
  onVersionOpen,
  children,
  sourceIndentControls,
  fallbackVisible = false,
  documentLanguage,
  onDocumentLanguageChange,
}: {
  enabled: boolean;
  focusMode?: boolean;
  label?: string;
  className?: string;
  saveStatus?: SaveStatus;
  block?: ReactNode;
  position?: ReactNode;
  positionRef?: RefObject<HTMLSpanElement>;
  characters?: number;
  words?: number;
  onVersionOpen?: () => void;
  children?: ReactNode;
  sourceIndentControls?: ReactNode;
  fallbackVisible?: boolean;
  documentLanguage?: string;
  onDocumentLanguageChange?: (language: string) => void;
}) {
  const state = useStatusBarDisplay(enabled, focusMode);
  if (!state.visible && !fallbackVisible) return null;
  const saveLabel =
    saveStatus === "dirty"
      ? "待保存"
      : saveStatus === "saving"
        ? "保存中"
        : saveStatus === "error"
          ? "保存失败"
          : "已保存到本机；GitHub 备份需要单独 Push";
  const content: Record<StatusItem, ReactNode> = {
    navigation: <NavigationButtons />,
    save:
      saveStatus !== undefined ? (
        <span
          className={`editor-save-state editor-save-state-${saveStatus}`}
          role="status"
          aria-label={saveLabel}
          title={saveLabel}
        >
          <ToolbarIcon
            name={
              saveStatus === "saving"
                ? "saving"
                : saveStatus === "error"
                  ? "warning"
                  : "check"
            }
          />
          {saveStatus === "dirty" ||
          saveStatus === "saving" ||
          saveStatus === "error"
            ? saveLabel
            : null}
        </span>
      ) : null,
    block:
      block !== undefined ? (
        <span className="editor-status-block">{block}</span>
      ) : null,
    position:
      position !== undefined ? (
        <span ref={positionRef} className="editor-status-position">
          {position}
        </span>
      ) : null,
    characters: characters !== undefined ? `${characters} 字符` : null,
    words: words !== undefined ? `${words} 词` : null,
    history: onVersionOpen ? (
      <button
        type="button"
        className="btn-version-icon"
        onClick={onVersionOpen}
        title="版本历史"
        aria-label="打开本机版本历史"
      >
        <ToolbarIcon name="history" />
        <span>历史</span>
      </button>
    ) : null,
  };
  const items = state.visible
    ? state.items.filter((k) => content[k] != null)
    : [];
  const firstAction = items.find((k) => k === "navigation" || k === "history");
  return (
    <div
      className={`editor-stats editor-status-bar ${className}`}
      role="group"
      aria-label={label}
      data-status-display={state.display ? "plugin" : undefined}
      data-status-show-in-focus={state.showInFocus || undefined}
      style={
        state.display
          ? (statusDisplayStyle(state.display) as CSSProperties)
          : undefined
      }
    >
      {children}
      {/* Save failures remain visible even when a presentation hides the save widget. */}
      {state.visible &&
        saveStatus === "error" &&
        !items.includes("save") &&
        content.save}
      {items.map((item) => {
        if (
          !state.display &&
          ["position", "characters", "words"].includes(item)
        ) {
          if (item !== "position" && items.includes("position")) return null;
          if (item === "words" && items.includes("characters")) return null;
          return (
            <span key={item} className="editor-status-secondary">
              {items
                .filter((k) => ["position", "characters", "words"].includes(k))
                .map((k) => (
                  <span key={k} data-status-item={k}>
                    {content[k]}
                  </span>
                ))}
            </span>
          );
        }
        return (
          <span
            className={`editor-status-item${item === firstAction ? " editor-status-actions-start" : ""}`}
            data-status-item={item}
            key={item}
          >
            {content[item]}
          </span>
        );
      })}
      {state.visible && sourceIndentControls}
      {state.visible && documentLanguage !== undefined && <select
        className="editor-document-language editor-status-select"
        aria-label="文件格式"
        title="文件格式；保留原始源码，控制可用视图与语法高亮"
        value={documentLanguage}
        disabled={!onDocumentLanguageChange}
        onChange={event => onDocumentLanguageChange?.(event.target.value)}
      >
        {DOCUMENT_LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>}
    </div>
  );
}
