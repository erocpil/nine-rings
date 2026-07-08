/// 数据库迁移版本定义
/// 与 Tauri 后端同步：schema_version = 3

const int schemaVersion = 3;

String migrationV1 = '''
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned DESC, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_notes_search ON notes(search_text);

CREATE TABLE IF NOT EXISTS daily_pages (
  date TEXT PRIMARY KEY,
  todos TEXT NOT NULL DEFAULT '[]',
  todo_carryover INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_changes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_synced ON sync_changes(synced_at);
CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp ON sync_changes(timestamp);

CREATE TABLE IF NOT EXISTS note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id);
''';

String migrationV2 = '''
-- tags column was added in v2 in the Tauri backend,
-- but we already include it in v1 schema, so this is a no-op.
-- Kept for version number alignment.
''';

String migrationV3 = '''
-- note_versions table was added in v3,
-- already created in v1 schema above. No-op.
''';
