import { formatDocumentSize } from "./document-size";
import type { DocType } from "../types/models";

const DOC_TYPE_LABELS: Record<DocType, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

export interface DocumentInfoRecord {
  title: string;
  contentBytes: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastAccessedAt?: string | null;
  readonly?: boolean;
  docType?: DocType;
  format?: string;
  tags?: readonly string[];
  path?: string | null;
}

export function formatDocumentTimestamp(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

export function documentInfoRows(info: DocumentInfoRecord): [string, string][] {
  return [
    ["大小", formatDocumentSize(info.contentBytes)],
    ["创建", formatDocumentTimestamp(info.createdAt)],
    ["修改", formatDocumentTimestamp(info.updatedAt)],
    ["访问", formatDocumentTimestamp(info.lastAccessedAt)],
    ["权限", info.readonly ? "只读" : "可编辑"],
    ["类型", info.docType ? DOC_TYPE_LABELS[info.docType] : info.format || "未分类"],
    ["标签", info.tags?.length ? info.tags.join(" · ") : "无"],
    ["路径", info.path || "未归档"],
  ];
}

export function formatDocumentInfoText(info: DocumentInfoRecord): string {
  return [
    `文档信息：${info.title || "无标题"}`,
    ...documentInfoRows(info).map(([label, value]) => `${label}：${value}`),
  ].join("\n");
}
