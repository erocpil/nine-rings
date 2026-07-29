-- Frozen from the released v4 schema (commit 0ab1617).
CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
INSERT INTO _schema_version VALUES (1);
INSERT INTO _schema_version VALUES (2);
INSERT INTO _schema_version VALUES (3);
INSERT INTO _schema_version VALUES (4);

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
    'v4-doc', '2026-07-01', 'v4 文档',
    '{"ops":[{"insert":"legacy v4 document"}]}', 'legacy v4 document',
    '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z',
    '["rust"]', 1, 4, '/docs/arch', 'explanation',
    '["rust","db"]', '["v4-note-2"]', 0
);

INSERT INTO daily_pages (date, todos, todo_carryover, updated_at)
VALUES ('2026-07-01', '[]', 0, '2026-07-01T00:00:00Z');

INSERT INTO note_versions (
    id, note_id, title, content, search_text, tags, pinned, sort_order, saved_at
) VALUES (
    'v4-version', 'v4-doc', 'v4 snapshot', '{"ops":[]}', '',
    '["rust"]', 1, 4, '2026-07-01T00:00:00Z'
);
