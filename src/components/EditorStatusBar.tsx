import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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
  children,
  sourceIndentControls,
  sourceViewControls,
  fallbackVisible = false,
  documentLanguage,
  onDocumentLanguageChange,
  onCreateDocument,
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
  children?: ReactNode;
  sourceIndentControls?: ReactNode;
  sourceViewControls?: ReactNode;
  fallbackVisible?: boolean;
  documentLanguage?: string;
  onDocumentLanguageChange?: (language: string) => void;
  onCreateDocument?: () => void;
}) {
  const state = useStatusBarDisplay(enabled, focusMode);
  const tooltipTitles = useRef(new Map<HTMLElement, string>());
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
  };
  const items = state.visible
    ? state.items.filter((k) => content[k] != null)
    : [];
  const firstAction = items.find((k) => k === "navigation");
  return (
    <div
      className={`editor-stats editor-status-bar ${className}`}
      role="group"
      aria-label={label}
      onPointerDownCapture={event => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[aria-haspopup], select") : null;
        if (!target?.title) return;
        tooltipTitles.current.set(target, target.title);
        target.removeAttribute("title");
      }}
      onPointerLeave={() => {
        for (const [element, title] of tooltipTitles.current) {
          if (element.isConnected && !element.title) element.title = title;
        }
        tooltipTitles.current.clear();
      }}
      data-status-display={state.display ? "plugin" : undefined}
      data-status-show-in-focus={state.showInFocus || undefined}
      onWheel={(event) => {
        const bar = event.currentTarget;
        if (bar.scrollWidth <= bar.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        bar.scrollLeft += event.deltaY;
        event.preventDefault();
      }}
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
      {state.visible && sourceViewControls}
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
      {state.visible && onCreateDocument && <button
        type="button"
        className="editor-status-create"
        aria-label="在当前路径新建文档"
        title="在当前路径新建同格式文档"
        onClick={onCreateDocument}
      ><ToolbarIcon name="plus" /></button>}
    </div>
  );
}
