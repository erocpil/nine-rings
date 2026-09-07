import type { ReactNode } from "react";
import { ToolbarIcon } from "./ToolbarIcon";

export function ListState({ kind, title, detail, onRetry }: {
  kind: "loading" | "empty" | "error";
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return <div className={`ui-list-state ui-list-state-${kind}`} role={kind === "error" ? "alert" : "status"}>
    <ToolbarIcon name={kind === "error" ? "warning" : kind === "loading" ? "saving" : "search"} />
    <strong>{title}</strong>
    {detail && <span>{detail}</span>}
    {onRetry && <button type="button" className="settings-btn" onClick={onRetry}>重新加载</button>}
  </div>;
}

/** Shared hierarchy for search results and the document switcher. */
export function DocumentListContent({ title, metadata, path, preview, variant }: {
  title: string;
  metadata: string;
  path?: string;
  preview?: ReactNode;
  variant: "search-hit" | "quick-switcher";
}) {
  return <span className="ui-list-content">
    <span className={`ui-list-title ${variant}-title`} title={title}>{title}</span>
    {path && <span className={`ui-list-path ${variant}-path`} title={path}>{path}</span>}
    <span className={`ui-list-meta ${variant}-meta`}>{metadata}</span>
    {preview && <span className={`ui-list-preview ${variant}-snippet`}>{preview}</span>}
  </span>;
}

export function PathPreview({ target, source, className = "" }: {
  target: string;
  source?: string;
  className?: string;
}) {
  return <div className={`ui-path-preview ${className}`} aria-label="位置预览">
    {source !== undefined && <><span>当前位置</span><code title={source}>{source || "文档根目录"}</code></>}
    <span>{source !== undefined ? "目标位置" : "保存位置"}</span>
    <code title={target}>{target || "请选择目标"}</code>
  </div>;
}
