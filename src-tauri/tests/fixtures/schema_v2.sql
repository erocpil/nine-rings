-- Frozen from the released v2 schema (commit 66f28a4).
CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
INSERT INTO _schema_version VALUES (1);
INSERT INTO _schema_version VALUES (2);

CREATE TABLE notes (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL DEFAULT '{}',
    search_text TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE daily_pages (
    date           TEXT PRIMARY KEY,
    todos          TEXT NOT NULL DEFAULT '[]',
    todo_carryover INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL
);

CREATE INDEX idx_notes_date ON notes(date, created_at);
CREATE INDEX idx_notes_updated ON notes(updated_at);

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
    tags, pinned, sort_order
) VALUES (
    'v2-note', '2026-05-01', 'v2 笔记',
    '{"ops":[{"insert":"legacy v2 text"}]}', 'legacy v2 text',
    '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
    '["tag1"]', 1, 5
);

INSERT INTO daily_pages (date, todos, todo_carryover, updated_at)
VALUES (
    '2026-05-01',
    '[{"id":"v2-todo","text":"legacy todo","done":false,"order":0,"tags":[]}]',
    1,
    '2026-05-01T00:00:00Z'
);
