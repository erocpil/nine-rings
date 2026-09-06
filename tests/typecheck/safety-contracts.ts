// Compile-only negative tests. An unused @ts-expect-error fails the type gate
// if these data boundaries accidentally regress to any.
import {
  materializeAutoSaveChanges,
  type AutoSaveChanges,
  type AutoSaveHandle,
} from "../../src/hooks/useAutoSave";
import { validateBackup } from "../../src/lib/backup-validation";
import { snakeImportToCamel } from "../../src/lib/storage/normalize";
import { noteToDB } from "../../src/lib/storage/core";
import type { Note } from "../../src/types/models";

declare const save: AutoSaveHandle;
save.markDirty({ ops: [{ insert: "text" }] });
// @ts-expect-error A raw string is not a serialized editor document.
save.markDirty("text");
// @ts-expect-error The deferred reader must produce the same document shape.
save.markContentDirty(() => 42);
// @ts-expect-error Title is not a numeric storage field.
const invalid: AutoSaveChanges = { title: 42 };
void invalid;
const snapshot = materializeAutoSaveChanges({ content: () => ({ ops: [] }) });
// @ts-expect-error Materialized content is a document, not a live reader.
snapshot.content?.();

declare const raw: unknown;
// @ts-expect-error No fields may be read before runtime validation.
raw.notes;
validateBackup(raw);
raw.notes[0].id.toUpperCase();
// @ts-expect-error Extension fields are still unknown after envelope validation.
raw.notes[0].customField.toUpperCase();
const normalized = snakeImportToCamel(raw.notes[0]);
// @ts-expect-error Renaming legacy fields does not validate arbitrary extensions.
normalized.customField.toUpperCase();

declare const note: Note;
const stored = noteToDB(note);
const flag: 0 | 1 = stored.pinned;
void flag;
// @ts-expect-error Storage flags are numeric, not application booleans (or never).
const booleanFlag: boolean = stored.pinned;
void booleanFlag;
