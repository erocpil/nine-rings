// 数据库历史迁移。目标版本由 schema/note.yaml 的生成产物统一提供。
import 'schema_gen.dart' show targetSchemaVersion;

const int schemaVersion = targetSchemaVersion;

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

String migrationV4 = '''
-- 文档管理系统（v2）字段
ALTER TABLE notes ADD COLUMN storage_path TEXT;
ALTER TABLE notes ADD COLUMN doc_type TEXT;
ALTER TABLE notes ADD COLUMN concepts TEXT;
ALTER TABLE notes ADD COLUMN linked_doc_ids TEXT;
ALTER TABLE notes ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notes_storage_path ON notes(storage_path);
''';

String migrationV5 = '''
-- FTS5 全文搜索虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, content, content=notes, content_rowid=rowid
);

-- 触发器：INSERT / DELETE / UPDATE 时同步 FTS 索引
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

-- 模板表
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  title_template TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  storage_path TEXT,
  doc_type TEXT,
  concepts TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
''';

String migrationV6 = '''
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TABLE IF EXISTS notes_fts;
CREATE VIRTUAL TABLE notes_fts USING fts5(search_text, content=notes, content_rowid=rowid);
CREATE TRIGGER notes_ai AFTER INSERT ON notes WHEN new.search_text != '' BEGIN
  INSERT INTO notes_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes WHEN old.search_text != '' BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, search_text)
    SELECT 'delete', old.rowid, old.search_text WHERE old.search_text != '';
  INSERT INTO notes_fts(rowid, search_text)
    SELECT new.rowid, new.search_text WHERE new.search_text != '';
END;
INSERT INTO notes_fts(rowid, search_text)
  SELECT rowid, search_text FROM notes WHERE search_text != '';
''';

String migrationV7 = '''
DROP INDEX IF EXISTS idx_notes_date;
DROP INDEX IF EXISTS idx_notes_updated;
DROP INDEX IF EXISTS idx_note_versions_note_id;
CREATE INDEX IF NOT EXISTS idx_notes_date_created_at ON notes(date, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);
CREATE INDEX IF NOT EXISTS idx_notes_pinned_sort_order ON notes(pinned, sort_order);
CREATE INDEX IF NOT EXISTS idx_notes_storage_path ON notes(storage_path);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id);
''';
