-- Frozen from the released v5 schema (commit 826f09e).
CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
INSERT INTO _schema_version VALUES (1);
INSERT INTO _schema_version VALUES (2);
INSERT INTO _schema_version VALUES (3);
INSERT INTO _schema_version VALUES (4);
INSERT INTO _schema_version VALUES (5);

CREATE TABLE notes (
    id             TEXT PRIMARY KEY,
    date           TEXT NOT NULL,
    title          TEXT,
    content        TEXT NOT NULL DEFAULT '{}',
    search_text    TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    pinned         INTEGER NOT NULL DEFAULT 0,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    storage_path   TEXT,
    doc_type       TEXT,
    concepts       TEXT NOT NULL DEFAULT '[]',
    linked_doc_ids TEXT NOT NULL DEFAULT '[]',
    readonly       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE daily_pages (
    date           TEXT PRIMARY KEY,
    todos          TEXT NOT NULL DEFAULT '[]',
    todo_carryover INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL
);

CREATE TABLE note_versions (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL DEFAULT '{}',
    search_text TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    saved_at    TEXT NOT NULL
);

CREATE TABLE templates (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT DEFAULT '',
    is_builtin     INTEGER NOT NULL DEFAULT 0,
    title_template TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    storage_path   TEXT,
    doc_type       TEXT,
    concepts       TEXT DEFAULT '[]',
    pinned         INTEGER NOT NULL DEFAULT 0,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE INDEX idx_notes_date ON notes(date, created_at);
CREATE INDEX idx_notes_updated ON notes(updated_at);
CREATE INDEX idx_note_versions_note_id ON note_versions(note_id, saved_at);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, content,
    content='notes',
    content_rowid='rowid'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.search_text);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.search_text);
END;

CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.search_text);
    INSERT INTO notes_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.search_text);
END;

INSERT INTO notes (
    id, date, title, content, search_text, created_at, updated_at,
    tags, pinned, sort_order, storage_path, doc_type, concepts,
    linked_doc_ids, readonly
) VALUES (
    'v5-doc', '2026-07-15', 'v5 文档',
    '{"ops":[{"insert":"legacy v5 document"}]}', 'legacy v5 document',
    '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z',
    '["migration"]', 0, 5, '/docs/v5', 'reference',
    '["migration"]', '[]', 0
);

INSERT INTO daily_pages (date, todos, todo_carryover, updated_at)
VALUES ('2026-07-15', '[]', 0, '2026-07-15T00:00:00Z');

INSERT INTO note_versions (
    id, note_id, title, content, search_text, tags, pinned, sort_order, saved_at
) VALUES (
    'v5-version', 'v5-doc', 'v5 snapshot', '{"ops":[]}', '',
    '["migration"]', 0, 5, '2026-07-15T00:00:00Z'
);

INSERT INTO templates (
    id, name, description, is_builtin, title_template, tags,
    storage_path, doc_type, concepts, pinned, sort_order,
    created_at, updated_at
) VALUES (
    'v5-template', '历史模板', 'v5 fixture', 0, '标题',
    '["migration"]', '/docs/v5', 'reference', '["migration"]',
    0, 1, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z'
);
