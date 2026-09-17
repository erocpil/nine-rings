import { ToolbarIcon } from "./ToolbarIcon";

/** Same chevron as document-tree folders; the owning control supplies its label. */
export function DisclosureIcon({ expanded = false }: { expanded?: boolean }) {
  return <span className={`disclosure-icon${expanded ? " expanded" : ""}`} aria-hidden="true"><ToolbarIcon name="chevronRight" /></span>;
}
