import { EditorStatusSelect } from "./EditorStatusSelect";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import {
  statusDisplayStyle,
  type StatusItem,
} from "../lib/plugin-system/status-display";
import { NavigationButtons } from "./NavigationButtons";
import { ToolbarIcon } from "./ToolbarIcon";
import { DOCUMENT_LANGUAGE_OPTIONS } from "../lib/document-language";
import { useStatusBarIdleGlow } from "../hooks/useStatusBarIdleGlow";
type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";
export function EditorStatusBar({
  enabled,
  focusMode = false,
  label = "文档状态栏",
  className = "",
  saveStatus,
  savedLabel,
  block,
  blockPosition,
  sourcePosition,
  position,
  positionRef,
  characters,
  words,
  children,
  sourceIndentControls,
  sourceViewControls,
  fallbackVisible = false,
  documentLanguage,
  documentLanguageValue,
  documentLanguageOptions,
  onDocumentLanguageChange,
  onCreateDocument,
  navigation = <NavigationButtons />,
}: {
  enabled: boolean;
  focusMode?: boolean;
  label?: string;
  className?: string;
  saveStatus?: SaveStatus;
  savedLabel?: string;
  block?: ReactNode;
  blockPosition?: { current: number; total: number };
  sourcePosition?: { line: number; column: number; total: number };
  position?: ReactNode;
  positionRef?: RefObject<HTMLSpanElement>;
  characters?: number;
  words?: number;
  children?: ReactNode;
  sourceIndentControls?: ReactNode;
  sourceViewControls?: ReactNode;
  fallbackVisible?: boolean;
  documentLanguage?: string;
  documentLanguageValue?: string;
  documentLanguageOptions?: ReadonlyArray<{ value: string; label: string }>;
  onDocumentLanguageChange?: (language: string) => void;
  onCreateDocument?: () => void;
  navigation?: ReactNode;
}) {
  const state = useStatusBarDisplay(enabled, focusMode);
  const idleGlow = useStatusBarIdleGlow(state.visible);
  const statusItemsKey = state.items.join("|");
  const barRef = useRef<HTMLDivElement>(null);
  const tooltipTitles = useRef(new Map<HTMLElement, string>());
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !idleGlow) return;

    const updateTravel = () => {
      const navigation = bar.querySelector<HTMLElement>(
        ':scope > [data-status-item="navigation"]',
      );
      if (!navigation || navigation.offsetWidth === 0) return;

      // offsetLeft/offsetWidth measure flex layout before transforms, so this
      // remains stable while the navigation controls are animating.
      const navigationIndex = Array.prototype.indexOf.call(
        bar.children,
        navigation,
      ) as number;
      let precedingRight = 0;
      for (let index = 0; index < navigationIndex; index += 1) {
        const child = bar.children[index] as HTMLElement | undefined;
        if (!child || child.offsetWidth === 0) continue;
        precedingRight = Math.max(
          precedingRight,
          child.offsetLeft + child.offsetWidth,
        );
      }
      const gap = navigation.offsetLeft - precedingRight;
      // Use the whole empty span and stop just before the preceding status
      // item, so the navigation controls travel until the whitespace ends.
      const travel = Math.max(0, gap - 8);
      const duration = Math.min(8, Math.max(3.2, travel / 100));
      navigation.style.setProperty(
        "--status-navigation-idle-travel",
        `${-travel}px`,
      );
      navigation.style.setProperty(
        "--status-navigation-idle-duration",
        `${duration}s`,
      );
    };

    updateTravel();
    const resizeObserver = new ResizeObserver(updateTravel);
    resizeObserver.observe(bar);
    for (const child of Array.from(bar.children)) resizeObserver.observe(child);
    const mutationObserver = new MutationObserver(updateTravel);
    mutationObserver.observe(bar, { childList: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      bar
        .querySelector<HTMLElement>(':scope > [data-status-item="navigation"]')
        ?.style.removeProperty("--status-navigation-idle-travel");
      bar
        .querySelector<HTMLElement>(':scope > [data-status-item="navigation"]')
        ?.style.removeProperty("--status-navigation-idle-duration");
    };
  }, [idleGlow, statusItemsKey, state.visible]);
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const underPointer = document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const bar =
        target?.closest<HTMLElement>(".editor-status-bar") ??
        underPointer?.closest<HTMLElement>(".editor-status-bar");
      if (
        !bar ||
        bar.scrollWidth <= bar.clientWidth ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      )
        return;
      event.preventDefault();
      const left = Math.min(
        bar.scrollWidth - bar.clientWidth,
        Math.max(0, bar.scrollLeft + event.deltaY),
      );
      requestAnimationFrame(() => {
        if (bar.isConnected) bar.scrollTo({ left, behavior: "instant" });
      });
    };
    // Status bars may be portaled into a sibling surface, so observe wheel
    // input at the document boundary and scroll the bar under the pointer.
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", wheel, true);
  }, []);
  if (!state.visible && !fallbackVisible) return null;
  const saveLabel =
    saveStatus === "dirty"
      ? "待保存"
      : saveStatus === "saving"
        ? "保存中"
        : saveStatus === "error"
          ? "保存失败"
          : (savedLabel ?? "已保存到本机；GitHub 备份需要单独 Push");
  const content: Record<StatusItem, ReactNode> = {
    navigation,
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
      blockPosition || block !== undefined ? (
        <span className="editor-status-block">
          {blockPosition
            ? `Block ${blockPosition.current}${state.showTotals ? `/${blockPosition.total}` : ""}`
            : block}
        </span>
      ) : null,
    position:
      sourcePosition || position !== undefined ? (
        <span ref={positionRef} className="editor-status-position">
          {sourcePosition
            ? `Ln ${sourcePosition.line}${state.showTotals ? `/${sourcePosition.total}` : ""}, Col ${sourcePosition.column}`
            : position}
        </span>
      ) : null,
    characters: characters !== undefined ? `${characters} chars` : null,
    words: words !== undefined ? `${words} words` : null,
  };
  const items = state.visible
    ? state.items.filter((k) => content[k] != null)
    : [];
  const firstAction = items.find((k) => k === "navigation");
  return (
    <div
      ref={barRef}
      className={`editor-stats editor-status-bar ${className}`}
      role="group"
      aria-label={label}
      onPointerDownCapture={(event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[aria-haspopup], select")
            : null;
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
      data-status-idle-glow={idleGlow ?? undefined}
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
      {state.visible &&
        (sourceViewControls ||
          sourceIndentControls ||
          documentLanguage !== undefined ||
          onCreateDocument) && (
          <span
            className={`editor-status-item editor-status-source-controls${firstAction ? "" : " editor-status-actions-start"}`}
          >
            {sourceViewControls}
            {sourceIndentControls}
            {documentLanguage !== undefined && (
              <EditorStatusSelect
                label="文件格式"
                title="文件格式；保留原始源码，控制可用视图与语法高亮"
                value={documentLanguageValue ?? documentLanguage}
                disabled={!onDocumentLanguageChange}
                options={documentLanguageOptions ?? DOCUMENT_LANGUAGE_OPTIONS}
                onChange={(language) => onDocumentLanguageChange?.(language)}
              />
            )}
            {onCreateDocument && (
              <button
                type="button"
                className="editor-status-create"
                aria-label="在当前路径新建文档"
                title="在当前路径新建同格式文档"
                onClick={onCreateDocument}
              >
                <ToolbarIcon name="plus" />
              </button>
            )}
          </span>
        )}
    </div>
  );
}
