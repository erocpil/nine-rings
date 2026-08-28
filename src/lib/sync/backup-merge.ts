import { extractPlainText, now, uuid } from "../storage/core";

type BackupRecord = Record<string, unknown>;

interface BackupBundle extends Record<string, unknown> {
  notes?: BackupRecord[];
  daily_pages?: BackupRecord[];
}

export type SyncDocumentKind = "document" | "note";

export interface SyncDocumentSummary {
  id: string;
  title: string;
  kind: SyncDocumentKind;
  storagePath: string | null;
  date: string | null;
  updatedAt: string | null;
  remoteTitle?: string;
}

export interface SyncPageComparison {
  localOnly: number;
  remoteOnly: number;
  localChanged: number;
  remoteChanged: number;
  conflicts: number;
  unchanged: number;
}

export interface BackupComparison {
  localOnly: SyncDocumentSummary[];
  remoteOnly: SyncDocumentSummary[];
  localChanged: SyncDocumentSummary[];
  remoteChanged: SyncDocumentSummary[];
  conflicts: SyncDocumentSummary[];
  unchanged: number;
  pages: SyncPageComparison;
  baseAvailable: boolean;
}

export interface SafeMergeResult {
  json: string;
  comparison: BackupComparison;
  conflictCopies: number;
  pageConflictCopies: number;
}

type MergeCategory = "localOnly" | "remoteOnly" | "localChanged" | "remoteChanged" | "conflicts" | "unchanged";

function parseBundle(json: string): BackupBundle {
  const parsed = JSON.parse(json) as BackupBundle;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("备份文件顶层必须是 JSON 对象");
  }
  if (parsed.notes !== undefined && !Array.isArray(parsed.notes)) {
    throw new Error("备份文件 notes 字段格式不正确");
  }
  if (parsed.daily_pages !== undefined && !Array.isArray(parsed.daily_pages)) {
    throw new Error("备份文件 daily_pages 字段格式不正确");
  }
  return parsed;
}

function parseJsonValue(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function stringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value, []);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = (value as Record<string, unknown>)[key];
      if (next !== undefined) result[key] = canonicalValue(next);
    }
    return result;
  }
  return value;
}

function noteIdentity(record: BackupRecord): Record<string, unknown> {
  return {
    date: record.date ?? null,
    title: record.title ?? null,
    content: parseJsonValue(record.content, {}),
    tags: stringArray(record.tags),
    pinned: booleanValue(record.pinned),
    readonly: booleanValue(record.readonly),
    storagePath: record.storagePath ?? record.storage_path ?? null,
    docType: record.docType ?? record.doc_type ?? null,
    concepts: stringArray(record.concepts),
    linkedDocIds: stringArray(record.linkedDocIds ?? record.linked_doc_ids),
  };
}

function pageIdentity(record: BackupRecord): Record<string, unknown> {
  return {
    date: record.date ?? null,
    todos: parseJsonValue(record.todos, []),
    todoCarryover: booleanValue(record.todo_carryover ?? record.todoCarryover),
  };
}

function todoIdentity(record: BackupRecord): Record<string, unknown> {
  const { id: _id, ...rest } = record;
  return rest;
}

function sameIdentity(
  left: BackupRecord | undefined,
  right: BackupRecord | undefined,
  identity: (record: BackupRecord) => Record<string, unknown>,
): boolean {
  if (!left || !right) return left === right;
  return JSON.stringify(canonicalValue(identity(left))) === JSON.stringify(canonicalValue(identity(right)));
}

function recordsBy(records: BackupRecord[] | undefined, key: "id" | "date"): Map<string, BackupRecord> {
  const result = new Map<string, BackupRecord>();
  for (const record of records ?? []) {
    const value = record?.[key];
    if (typeof value === "string" && value) result.set(value, record);
  }
  return result;
}

function classifyRecord(
  local: BackupRecord | undefined,
  remote: BackupRecord | undefined,
  base: BackupRecord | undefined,
  identity: (record: BackupRecord) => Record<string, unknown>,
): MergeCategory {
  if (local && !remote) return "localOnly";
  if (!local && remote) return "remoteOnly";
  if (!local || !remote) return "unchanged";
  if (sameIdentity(local, remote, identity)) return "unchanged";
  if (!base) return "conflicts";

  const localMatchesBase = sameIdentity(local, base, identity);
  const remoteMatchesBase = sameIdentity(remote, base, identity);
  if (localMatchesBase && !remoteMatchesBase) return "remoteChanged";
  if (!localMatchesBase && remoteMatchesBase) return "localChanged";
  return "conflicts";
}

function documentSummary(record: BackupRecord, remote?: BackupRecord): SyncDocumentSummary {
  const storagePath = record.storagePath ?? record.storage_path ?? null;
  return {
    id: String(record.id),
    title: typeof record.title === "string" && record.title.trim() ? record.title : "无标题",
    kind: storagePath ? "document" : "note",
    storagePath: typeof storagePath === "string" && storagePath ? storagePath : null,
    date: typeof record.date === "string" ? record.date : null,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
    ...(remote && remote.title !== record.title
      ? { remoteTitle: typeof remote.title === "string" && remote.title.trim() ? remote.title : "无标题" }
      : {}),
  };
}

function sortSummaries(items: SyncDocumentSummary[]): SyncDocumentSummary[] {
  return items.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "document" ? -1 : 1;
    return `${left.storagePath ?? ""}/${left.title}`.localeCompare(`${right.storagePath ?? ""}/${right.title}`, "zh-CN");
  });
}

function createComparison(
  local: BackupBundle,
  remote: BackupBundle,
  base?: BackupBundle,
): BackupComparison {
  const comparison: BackupComparison = {
    localOnly: [],
    remoteOnly: [],
    localChanged: [],
    remoteChanged: [],
    conflicts: [],
    unchanged: 0,
    pages: { localOnly: 0, remoteOnly: 0, localChanged: 0, remoteChanged: 0, conflicts: 0, unchanged: 0 },
    baseAvailable: Boolean(base),
  };
  const localNotes = recordsBy(local.notes, "id");
  const remoteNotes = recordsBy(remote.notes, "id");
  const baseNotes = recordsBy(base?.notes, "id");
  const noteIds = new Set([...localNotes.keys(), ...remoteNotes.keys()]);
  for (const id of noteIds) {
    const localNote = localNotes.get(id);
    const remoteNote = remoteNotes.get(id);
    const category = classifyRecord(localNote, remoteNote, baseNotes.get(id), noteIdentity);
    if (category === "unchanged") {
      comparison.unchanged += 1;
    } else {
      const source = localNote ?? remoteNote;
      if (source) comparison[category].push(documentSummary(source, localNote && remoteNote ? remoteNote : undefined));
    }
  }
  comparison.localOnly = sortSummaries(comparison.localOnly);
  comparison.remoteOnly = sortSummaries(comparison.remoteOnly);
  comparison.localChanged = sortSummaries(comparison.localChanged);
  comparison.remoteChanged = sortSummaries(comparison.remoteChanged);
  comparison.conflicts = sortSummaries(comparison.conflicts);

  const localPages = recordsBy(local.daily_pages, "date");
  const remotePages = recordsBy(remote.daily_pages, "date");
  const basePages = recordsBy(base?.daily_pages, "date");
  const pageDates = new Set([...localPages.keys(), ...remotePages.keys()]);
  for (const date of pageDates) {
    const category = classifyRecord(localPages.get(date), remotePages.get(date), basePages.get(date), pageIdentity);
    comparison.pages[category] += 1;
  }
  return comparison;
}

function conflictCopy(record: BackupRecord, timestamp: string): BackupRecord {
  const title = typeof record.title === "string" && record.title.trim() ? record.title : "无标题";
  const content = parseJsonValue(record.content, {});
  return {
    ...record,
    id: uuid(),
    title: `${title}（本地同步冲突副本）`,
    search_text: extractPlainText(content),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function todoConflictCopy(record: BackupRecord): BackupRecord {
  return {
    ...record,
    id: uuid(),
    text: `${typeof record.text === "string" ? record.text : "待办"}（本地同步冲突副本）`,
  };
}

function mergeConflictPage(local: BackupRecord, remote: BackupRecord, base?: BackupRecord): { page: BackupRecord; copies: number } {
  const localTodos = recordsBy(parseJsonValue(local.todos, []) as BackupRecord[], "id");
  const remoteTodos = recordsBy(parseJsonValue(remote.todos, []) as BackupRecord[], "id");
  const baseTodos = recordsBy(parseJsonValue(base?.todos, []) as BackupRecord[], "id");
  const mergedTodos: BackupRecord[] = [];
  let copies = 0;
  const todoIds = new Set([...remoteTodos.keys(), ...localTodos.keys()]);
  for (const id of todoIds) {
    const localTodo = localTodos.get(id);
    const remoteTodo = remoteTodos.get(id);
    const category = classifyRecord(localTodo, remoteTodo, baseTodos.get(id), todoIdentity);
    if (category === "localOnly" || category === "localChanged") {
      if (localTodo) mergedTodos.push(localTodo);
    } else if (category === "conflicts") {
      if (remoteTodo) mergedTodos.push(remoteTodo);
      if (localTodo) {
        mergedTodos.push(todoConflictCopy(localTodo));
        copies += 1;
      }
    } else if (remoteTodo) {
      mergedTodos.push(remoteTodo);
    }
  }
  return {
    page: {
      ...remote,
      todos: mergedTodos,
      updated_at: now(),
    },
    copies,
  };
}

export function compareBackupSnapshots(localJson: string, remoteJson: string, baseJson?: string | null): BackupComparison {
  return createComparison(
    parseBundle(localJson),
    parseBundle(remoteJson),
    baseJson ? parseBundle(baseJson) : undefined,
  );
}

export function buildSafeMergedBackup(localJson: string, remoteJson: string, baseJson?: string | null): SafeMergeResult {
  const local = parseBundle(localJson);
  const remote = parseBundle(remoteJson);
  const base = baseJson ? parseBundle(baseJson) : undefined;
  const comparison = createComparison(local, remote, base);
  const localNotes = recordsBy(local.notes, "id");
  const remoteNotes = recordsBy(remote.notes, "id");
  const baseNotes = recordsBy(base?.notes, "id");
  const mergedNotes: BackupRecord[] = [];
  const timestamp = now();
  let conflictCopies = 0;

  const noteIds = new Set([...remoteNotes.keys(), ...localNotes.keys()]);
  for (const id of noteIds) {
    const localNote = localNotes.get(id);
    const remoteNote = remoteNotes.get(id);
    const category = classifyRecord(localNote, remoteNote, baseNotes.get(id), noteIdentity);
    if (category === "localOnly" || category === "localChanged") {
      if (localNote) mergedNotes.push(localNote);
    } else if (category === "conflicts") {
      if (remoteNote) mergedNotes.push(remoteNote);
      if (localNote) {
        mergedNotes.push(conflictCopy(localNote, timestamp));
        conflictCopies += 1;
      }
    } else if (remoteNote) {
      mergedNotes.push(remoteNote);
    }
  }

  const localPages = recordsBy(local.daily_pages, "date");
  const remotePages = recordsBy(remote.daily_pages, "date");
  const basePages = recordsBy(base?.daily_pages, "date");
  const mergedPages: BackupRecord[] = [];
  let pageConflictCopies = 0;
  const pageDates = new Set([...remotePages.keys(), ...localPages.keys()]);
  for (const date of pageDates) {
    const localPage = localPages.get(date);
    const remotePage = remotePages.get(date);
    const basePage = basePages.get(date);
    const category = classifyRecord(localPage, remotePage, basePage, pageIdentity);
    if (category === "localOnly" || category === "localChanged") {
      if (localPage) mergedPages.push(localPage);
    } else if (category === "conflicts" && localPage && remotePage) {
      const merged = mergeConflictPage(localPage, remotePage, basePage);
      mergedPages.push(merged.page);
      pageConflictCopies += merged.copies;
    } else if (remotePage) {
      mergedPages.push(remotePage);
    }
  }

  const merged: BackupBundle = {
    ...remote,
    notes: mergedNotes,
    daily_pages: mergedPages,
  };
  return {
    json: JSON.stringify(merged),
    comparison,
    conflictCopies,
    pageConflictCopies,
  };
}
