// 自动生成自 schema/note.yaml — 请勿手工编辑
// 工具: scripts/gen-schema.py

/// 所有 CREATE TABLE 语句（初始 schema，不含迁移）
pub const SCHEMA_DDL: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS notes (\n    id TEXT PRIMARY KEY,\n    date TEXT NOT NULL,\n    title TEXT,\n    content TEXT NOT NULL DEFAULT '{}',\n    tags TEXT NOT NULL DEFAULT '[]',\n    pinned INTEGER NOT NULL DEFAULT 0,\n    sort_order INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    deleted_at TEXT,\n    storagePath TEXT,\n    docType TEXT,\n    concepts TEXT DEFAULT '[]',\n    linkedDocIds TEXT DEFAULT '[]',\n    readonly INTEGER NOT NULL DEFAULT 0\n);",
    "CREATE INDEX IF NOT EXISTS idx_notes_date_created_at ON notes(date, created_at);",
    "CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);",
    "CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);",
    "CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);",
    "CREATE INDEX IF NOT EXISTS idx_notes_pinned_sort_order ON notes(pinned, sort_order);",
    "CREATE INDEX IF NOT EXISTS idx_notes_storagePath ON notes(storagePath);",
    "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(search_text, content='notes', content_rowid='rowid');",
    "CREATE TABLE IF NOT EXISTS daily_pages (\n    date TEXT PRIMARY KEY,\n    todos TEXT NOT NULL DEFAULT '[]',\n    todo_carryover INTEGER NOT NULL DEFAULT 0,\n    updated_at TEXT NOT NULL\n);",
    "CREATE TABLE IF NOT EXISTS note_versions (\n    id TEXT PRIMARY KEY,\n    note_id TEXT NOT NULL,\n    title TEXT,\n    content TEXT NOT NULL DEFAULT '{}',\n    tags TEXT NOT NULL DEFAULT '[]',\n    pinned INTEGER NOT NULL DEFAULT 0,\n    sort_order INTEGER NOT NULL DEFAULT 0,\n    saved_at TEXT NOT NULL\n);",
    "CREATE INDEX IF NOT EXISTS idx_note_versions_note_id ON note_versions(note_id);",
    "CREATE TABLE IF NOT EXISTS sync_changes (\n    id TEXT PRIMARY KEY,\n    entity_type TEXT NOT NULL,\n    entity_id TEXT NOT NULL,\n    action TEXT NOT NULL,\n    data TEXT NOT NULL,\n    timestamp TEXT NOT NULL,\n    synced_at TEXT\n);",
    "CREATE INDEX IF NOT EXISTS idx_sync_changes_entity_type_entity_id ON sync_changes(entity_type, entity_id);",
    "CREATE INDEX IF NOT EXISTS idx_sync_changes_timestamp ON sync_changes(timestamp);",
    "CREATE TABLE IF NOT EXISTS templates (\n    id TEXT PRIMARY KEY,\n    name TEXT NOT NULL,\n    description TEXT DEFAULT '',\n    is_builtin INTEGER NOT NULL DEFAULT 0,\n    title_template TEXT,\n    tags TEXT NOT NULL DEFAULT '[]',\n    storage_path TEXT,\n    doc_type TEXT,\n    concepts TEXT DEFAULT '[]',\n    pinned INTEGER NOT NULL DEFAULT 0,\n    sort_order INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n);",
];
