import { documentSizeBytes } from "../lib/document-size";
import { documentInfoRows } from "../lib/document-info";
import type { CSSProperties, PointerEventHandler } from "react";
import type { DeltaOps, DocType } from "../types/models";

export interface DocumentInfoCardProps {
  title: string;
  content?: DeltaOps;
  contentBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string | null;
  readonly?: boolean;
  docType?: DocType;
  format?: string;
  tags: string[];
  path?: string;
  className?: string;
  style?: CSSProperties;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

export function DocumentInfoCard({ title, content, contentBytes, createdAt, updatedAt, lastAccessedAt, readonly, docType, format, tags, path, className, style, onPointerEnter, onPointerLeave }: DocumentInfoCardProps) {
  const rows = documentInfoRows({
    title,
    contentBytes: contentBytes ?? documentSizeBytes(content ?? { ops: [] }),
    createdAt,
    updatedAt,
    lastAccessedAt,
    readonly,
    docType,
    format,
    tags,
    path,
  });

  return <div className={`document-info-card${className ? ` ${className}` : ""}`} style={style} role="tooltip" aria-label={`${title} 的文档信息`} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
    <div className="document-info-card-title">{title || "无标题"}</div>
    <dl>{rows.map(([label, value]) => <div className="document-info-card-row" key={label}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}</dl>
  </div>;
}
