import { ToolbarIcon } from "./ToolbarIcon";

/** One pressed-state presentation for source and rendered workspace titles. */
export function MoreToolsButton({ expanded, onToggle, title = "更多工具", className = "" }: {
  expanded: boolean;
  onToggle: () => void;
  title?: string;
  className?: string;
}) {
  return <button type="button" className={`document-more-tools ${className}${expanded ? " active" : ""}`}
    title={title} aria-label="更多工具" data-tooltip-always="true"
    aria-expanded={expanded} aria-pressed={expanded} onClick={onToggle}>
    <ToolbarIcon name="tools" />
  </button>;
}
