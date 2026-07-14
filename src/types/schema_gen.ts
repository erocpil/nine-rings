// 自动生成自 schema/note.yaml — 请勿手工编辑
// 工具: scripts/gen-schema.py
// 注：此文件为 schema 参考，实际类型定义见 src/types/models.ts

import type { DeltaOps } from './models';

export type DocType = 'explanation' | 'how-to' | 'reference' | 'tutorial';

/** 一条随笔笔记 / 文档 */
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
  /** Zettelkasten 概念标签 */
  concepts: string[] | null;
  /** 关联文档 ID 列表 */
  linkedDocIds: string[] | null;
  readonly: boolean;
}

/** 待办项（嵌入在 DailyPage.todos 中，非独立表） */
export interface SchemaTodo {
  id: string;
  text: string;
  done: boolean;
  order: number;
  tags: string[];
  /** 提醒时间 */
  remind_at: string | null;
  /** 父待办 ID，null 表示顶层 */
  parent_id: string | null;
}

/** 每日一页 */
export interface SchemaDailyPage {
  date: string;
  /** Todo[] JSON */
  todos: string[];
  todo_carryover: boolean;
  updated_at: string;
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
  /** daily_page | note */
  entity_type: string;
  entity_id: string;
  /** create | update | delete */
  action: string;
  /** JSON string */
  data: string;
  timestamp: string;
  synced_at: string | null;
}

// ── IndexedDB store 定义（供 schema 校验参考）──

export const IDB_STORES: Record<string, { keyPath: string; indexes: string[][] }> = {
  notes: {
    keyPath: 'id',
    indexes: [
    ['date', 'created_at'],
    ['updated_at'],
    ['deleted_at'],
    ['tags'],
    ['pinned', 'sort_order'],
    ['storagePath']
    ],
  },
  daily_pages: {
    keyPath: 'date',
    indexes: [

    ],
  },
  note_versions: {
    keyPath: 'id',
    indexes: [
    ['note_id']
    ],
  },
  sync_changes: {
    keyPath: 'id',
    indexes: [
    ['entity_type', 'entity_id'],
    ['timestamp']
    ],
  },
};
