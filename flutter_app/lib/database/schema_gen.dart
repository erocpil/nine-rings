// 自动生成自 schema/note.yaml — 请勿手工编辑
// 生成时间: 2026-07-11T03:14:21Z
// 工具: scripts/gen-schema.py

/// 初始 schema 版本号
const int schemaVersion = 1;

/// 完整初始 schema DDL
const String migrationV1 = '''
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  storagePath TEXT,
  docType TEXT,
  concepts TEXT DEFAULT '[]',
  linkedDocIds TEXT DEFAULT '[]',
  readonly INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notes_date_created_at ON notes(date, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);
CREATE INDEX IF NOT EXISTS idx_notes_pinned_sort_order ON notes(pinned, sort_order);
CREATE INDEX IF NOT EXISTS idx_notes_storagePath ON notes(storagePath);

CREATE TABLE IF NOT EXISTS daily_pages (
  date TEXT PRIMARY KEY,
  todos TEXT NOT NULL DEFAULT '[]',
  todo_carryover INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id);

CREATE TABLE IF NOT EXISTS sync_changes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_entity_type_entity_id ON sync_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp ON sync_changes(timestamp);

''';
