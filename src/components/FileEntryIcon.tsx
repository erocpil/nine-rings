import { localFileLinkLabel, type FileNode } from "../lib/local-files/file-model";
import { ToolbarIcon } from "./ToolbarIcon";
import "../styles/file-entry-icon.css";

export function FileEntryIcon({ item, className = "" }: { item: Pick<FileNode, "directory" | "link">; className?: string }) {
  const { directory, link } = item;
  const blocked = link && link !== "file" && link !== "directory";
  return <span className={`file-entry-icon ${className}`} aria-hidden="true" title={link ? localFileLinkLabel[link] : undefined} data-file-link={link}>
    <ToolbarIcon name={directory || link === "directory" ? "folder" : "document"} />
    {link && <span className="file-entry-emblem" data-emblem={blocked ? "warning" : "arrow"}>
      <ToolbarIcon name={blocked ? "warning" : "fileLinkArrow"} />
    </span>}
  </span>;
}
