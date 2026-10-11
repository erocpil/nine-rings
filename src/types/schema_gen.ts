// 自动生成自 schema/note.yaml — 请勿手工编辑
// 工具: scripts/gen-schema.py
// 注：此文件为 schema 参考，实际类型定义见 src/types/models.ts

import type { DeltaOps } from './models';

export type DocType = 'explanation' | 'how-to' | 'reference' | 'tutorial';

/** 加密路径独立记录（包括空目录） */
export interface SchemaProtectedPathRecord {
  id: string;
  /** ProtectedPath JSON，不含密码或密钥 */
  data: string;
}

/** 一篇文档 */
export interface SchemaNote {
  id: string;
  date: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** P.A.R.A. 目录路径, e.g. projects/nine-rings */
  storagePath: string | null;
  /** Diátaxis 类型: explanation|how-to|reference|tutorial */
  docType: DocType | null;
  /** 关联文档 ID 列表 */
  linkedDocIds: string[] | null;
  /** Zettelkasten 概念标签 */
  concepts: string[] | null;
  readonly: boolean;
}

/** 笔记版本历史 */
export interface SchemaNoteVersion {
  id: string;
  /** FK → notes.id */
  note_id: string;
  title: string | null;
  content: DeltaOps;
  tags: string[];
  pinned: boolean;
  sort_order: number;
  saved_at: string;
}

/** 同步变更日志 */
export interface SchemaSyncChange {
  id: string;
  /** note */
  entity_type: string;
  entity_id: string;
  /** create | update | delete */
  action: string;
  /** JSON string */
  data: string;
  timestamp: string;
  synced_at: string | null;
}

/** 元数据模板（新建笔记时预填标签/路径/类型/概念） */
export interface SchemaTemplate {
  id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  /** 新建笔记的默认标题 */
  title_template: string | null;
  tags: string[];
  storage_path: string | null;
  doc_type: DocType | null;
  concepts: string[];
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── IndexedDB 运行时契约 ──

export const IDB_DATABASE_VERSION = 6;

export const IDB_STORES = {
  notes: {
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'deleted_at', keyPath: 'deleted_at' },
      { name: 'tags', keyPath: 'tags' },
      { name: 'pinned_sort', keyPath: ['pinned', 'sort_order'] },
      { name: 'storagePath', keyPath: 'storagePath' },
      { name: 'document_summary', keyPath: ['updated_at', 'document_summary'] },
    ],
  },
  note_versions: {
    keyPath: 'id',
    indexes: [
      { name: 'note_id', keyPath: 'note_id' },
    ],
  },
  images: {
    keyPath: 'id',
    indexes: [
    ],
  },
  protected_paths: {
    keyPath: 'id',
    indexes: [
    ],
  },
} as const;
