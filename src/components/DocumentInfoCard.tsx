import { documentSizeBytes, formatDocumentSize } from "../lib/document-size";
import type { DeltaOps, DocType } from "../types/models";

const DOC_TYPE_LABELS: Record<DocType, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

export interface DocumentInfoCardProps {
  title: string;
  content: DeltaOps;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  readonly?: boolean;
  docType?: DocType;
  tags: string[];
  path?: string;
}

export function DocumentInfoCard({ title, content, createdAt, updatedAt, lastAccessedAt, readonly, docType, tags, path }: DocumentInfoCardProps) {
  const rows = [
    ["大小", formatDocumentSize(documentSizeBytes(content))],
    ["创建", formatTimestamp(createdAt)],
    ["修改", formatTimestamp(updatedAt)],
    ["访问", formatTimestamp(lastAccessedAt)],
    ["权限", readonly ? "只读" : "可编辑"],
    ["类型", docType ? DOC_TYPE_LABELS[docType] : "未分类"],
    ["标签", tags.length ? tags.join(" · ") : "无"],
    ["路径", path || "未归档"],
  ] as const;

  return <div className="document-info-card" role="tooltip" aria-label={`${title} 的文档信息`}>
    <div className="document-info-card-title">{title || "无标题"}</div>
    <dl>{rows.map(([label, value]) => <div className="document-info-card-row" key={label}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}</dl>
  </div>;
}
