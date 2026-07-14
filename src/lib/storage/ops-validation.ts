/**
 * 垂直验证：5 个真实操作的 Op 定义 + 预期 SQL + 预期 IDB 操作。
 *
 * 用法：npx tsx src/lib/storage/ops-validation.ts
 * 每条验证打印 Op → 预期 SQL → 实际 SQL → 是否匹配。
 */

import type { Op, SelectOp, InsertOp, UpdateOp } from "./ops";

// ═══════════════════════════════════════════════════════════════════
// 1. get_notes_by_date
// ═══════════════════════════════════════════════════════════════════
const getNotesByDate: SelectOp = {
  type: "select",
  table: "notes",
  columns: [
    "id", "date", "title", "content", "search_text", "tags",
    "pinned", "sort_order", "created_at", "updated_at",
    "storage_path", "doc_type", "concepts", "linked_doc_ids", "readonly",
  ],
  where: [
    { col: "date", op: "=", val: "2026-07-15" },
    // deleted_at IS NULL 由 includeDeleted=false（默认）自动追加
  ],
  orderBy: [
    { col: "pinned", desc: true },
    { col: "sort_order" },
    { col: "created_at" },
  ],
};

const expectedSQL_getNotesByDate =
  `SELECT id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly FROM notes WHERE date = ? AND deleted_at IS NULL ORDER BY pinned DESC, sort_order ASC, created_at ASC`;

// ═══════════════════════════════════════════════════════════════════
// 2. create_note
// ═══════════════════════════════════════════════════════════════════
const createNote: InsertOp = {
  type: "insert",
  table: "notes",
  values: {
    id: "abc-123",
    date: "2026-07-15",
    title: "测试笔记",
    content: '{"ops":[]}',
    search_text: "",
    tags: '["tag1","tag2"]',
    pinned: 0,
    sort_order: 3,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    storage_path: "projects/test",
    doc_type: "how-to",
    concepts: '["concept-a"]',
    linked_doc_ids: '["id-1"]',
    readonly: 0,
  },
};

const expectedSQL_createNote =
  `INSERT INTO notes (id, date, title, content, search_text, tags, pinned, sort_order, created_at, updated_at, storage_path, doc_type, concepts, linked_doc_ids, readonly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// ═══════════════════════════════════════════════════════════════════
// 3. update_note（部分字段更新）
// ═══════════════════════════════════════════════════════════════════
const updateNote: UpdateOp = {
  type: "update",
  table: "notes",
  set: {
    title: "改名后的笔记",
    content: '{"ops":[{"insert":"hello"}]}',
    search_text: "hello",
    updated_at: "2026-07-15T01:00:00Z",
  },
  where: [
    { col: "id", op: "=", val: "abc-123" },
    { col: "deleted_at", op: "IS", val: null },
  ],
};

const expectedSQL_updateNote =
  `UPDATE notes SET title = ?, content = ?, search_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`;

// ═══════════════════════════════════════════════════════════════════
// 4. delete_note（软删除）
// ═══════════════════════════════════════════════════════════════════
const deleteNote: UpdateOp = {
  type: "update",
  table: "notes",
  set: {
    deleted_at: "2026-07-15T02:00:00Z",
    updated_at: "2026-07-15T02:00:00Z",
  },
  where: [
    { col: "id", op: "=", val: "abc-123" },
  ],
};

const expectedSQL_deleteNote =
  `UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`;

// ═══════════════════════════════════════════════════════════════════
// 5. get_path_tree（文档笔记部分——带 storage_path 的 GROUP BY + 文档列表）
// ═══════════════════════════════════════════════════════════════════

// Part A: 查所有有 storage_path 的笔记（用于构建文档节点）
const getDocsWithPath: SelectOp = {
  type: "select",
  table: "notes",
  columns: [
    "id", "title", "storage_path", "doc_type", "updated_at", "readonly",
  ],
  where: [
    { col: "storage_path", op: "IS", val: null, not: true },
  ],
  orderBy: [
    { col: "storage_path" },
    { col: "updated_at", desc: true },
  ],
};

// Part B: 查所有 daily 笔记（storage_path IS NULL）
const getDailyNotes: SelectOp = {
  type: "select",
  table: "notes",
  columns: ["id", "date", "title", "updated_at"],
  where: [
    { col: "storage_path", op: "IS", val: null },
  ],
  orderBy: [
    { col: "date", desc: true },
    { col: "updated_at", desc: true },
  ],
};

const expectedSQL_getDocsWithPath =
  `SELECT id, title, storage_path, doc_type, updated_at, readonly FROM notes WHERE storage_path IS NOT NULL AND deleted_at IS NULL ORDER BY storage_path ASC, updated_at DESC`;

const expectedSQL_getDailyNotes =
  `SELECT id, date, title, updated_at FROM notes WHERE storage_path IS NULL AND deleted_at IS NULL ORDER BY date DESC, updated_at DESC`;

// ═══════════════════════════════════════════════════════════════════
// SQL 编译器（简化版，只做验证用）
// ═══════════════════════════════════════════════════════════════════

function compileSelect(op: SelectOp): string {
  const cols = op.columns.join(", ");
  let sql = `SELECT ${cols} FROM ${op.table}`;

  const allWhere = [...(op.where || [])];

  // 自动追加软删除过滤（除非显式要求包含已删除记录）
  if (!op.includeDeleted) {
    allWhere.push({ col: "deleted_at", op: "IS", val: null });
  }

  if (allWhere.length > 0) {
    const clauses = allWhere.map((w) => {
      // IS NULL / IS NOT NULL
      if (w.op === "IS" && w.val === null) {
        return w.not ? `${w.col} IS NOT NULL` : `${w.col} IS NULL`;
      }
      // != NULL → IS NOT NULL
      if (w.op === "!=" && w.val === null) {
        return `${w.col} IS NOT NULL`;
      }
      // = NULL → IS NULL
      if (w.op === "=" && w.val === null) {
        return `${w.col} IS NULL`;
      }
      const notPrefix = w.not ? "NOT " : "";
      return `${notPrefix}${w.col} ${w.op} ?`;
    });
    sql += " WHERE " + clauses.join(" AND ");
  }

  if (op.orderBy && op.orderBy.length > 0) {
    const orders = op.orderBy.map((o) => {
      const dir = o.desc ? "DESC" : "ASC";
      return `${o.col} ${dir}`;
    });
    sql += " ORDER BY " + orders.join(", ");
  }

  if (op.limit) sql += ` LIMIT ${op.limit}`;
  if (op.offset) sql += ` OFFSET ${op.offset}`;
  return sql;
}

function compileInsert(op: InsertOp): string {
  const cols = Object.keys(op.values).filter((k) => op.values[k] !== undefined);
  const placeholders = cols.map(() => "?").join(", ");
  const prefix = op.onConflict === "replace" ? "INSERT OR REPLACE" : "INSERT";
  return `${prefix} INTO ${op.table} (${cols.join(", ")}) VALUES (${placeholders})`;
}

function compileUpdate(op: UpdateOp): string {
  const sets = Object.keys(op.set)
    .filter((k) => op.set[k] !== undefined)
    .map((k) => `${k} = ?`);
  const wheres = op.where.map((w) => {
    if (w.op === "IS" && w.val === null) return `${w.col} IS NULL`;
    return `${w.col} ${w.op} ?`;
  });
  return `UPDATE ${op.table} SET ${sets.join(", ")} WHERE ${wheres.join(" AND ")}`;
}

function compileSQL(op: Op): string {
  switch (op.type) {
    case "select": return compileSelect(op);
    case "insert": return compileInsert(op);
    case "update": return compileUpdate(op);
    case "raw": return op.sql;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 验证
// ═══════════════════════════════════════════════════════════════════

interface TestCase {
  name: string;
  op: Op;
  expectedSQL: string;
}

const tests: TestCase[] = [
  { name: "get_notes_by_date", op: getNotesByDate, expectedSQL: expectedSQL_getNotesByDate },
  { name: "create_note", op: createNote, expectedSQL: expectedSQL_createNote },
  { name: "update_note", op: updateNote, expectedSQL: expectedSQL_updateNote },
  { name: "delete_note", op: deleteNote, expectedSQL: expectedSQL_deleteNote },
  { name: "getDocsWithPath", op: getDocsWithPath, expectedSQL: expectedSQL_getDocsWithPath },
  { name: "getDailyNotes", op: getDailyNotes, expectedSQL: expectedSQL_getDailyNotes },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const actual = compileSQL(t.op);
  const ok = actual === t.expectedSQL;
  if (ok) {
    console.log(`✓ ${t.name}`);
    passed++;
  } else {
    console.log(`✗ ${t.name}`);
    console.log(`  Expected: ${t.expectedSQL}`);
    console.log(`  Actual:   ${actual}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

// ═══════════════════════════════════════════════════════════════════
// undefined vs null 语义测试
// ═══════════════════════════════════════════════════════════════════

const createWithUndefined: InsertOp = {
  type: "insert",
  table: "notes",
  values: {
    id: "abc",
    title: "test",
    content: undefined,  // 不写入，让 DB 用 DEFAULT
    search_text: undefined,
    tags: "[]",
    pinned: 0,
    sort_order: 0,
    created_at: "now",
    updated_at: "now",
    concepts: "[]",
    linked_doc_ids: "[]",
    readonly: 0,
  },
};

const expectedSQL_undefined =
  "INSERT INTO notes (id, title, tags, pinned, sort_order, created_at, updated_at, concepts, linked_doc_ids, readonly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const actual_undefined = compileInsert(createWithUndefined);
if (actual_undefined === expectedSQL_undefined) {
  console.log("✓ undefined columns omitted from INSERT");
  passed++;
} else {
  console.log("✗ undefined columns NOT omitted");
  console.log(`  Expected: ${expectedSQL_undefined}`);
  console.log(`  Actual:   ${actual_undefined}`);
  failed++;
}

const updateWithUndefined: UpdateOp = {
  type: "update",
  table: "notes",
  set: {
    title: "new",
    content: undefined,   // 不更新此列
  },
  where: [{ col: "id", op: "=", val: "abc" }],
};

const expectedSQL_updateUndefined =
  "UPDATE notes SET title = ? WHERE id = ?";

const actual_updateUndefined = compileUpdate(updateWithUndefined);
if (actual_updateUndefined === expectedSQL_updateUndefined) {
  console.log("✓ undefined columns omitted from UPDATE");
  passed++;
} else {
  console.log("✗ undefined columns NOT omitted");
  console.log(`  Expected: ${expectedSQL_updateUndefined}`);
  console.log(`  Actual:   ${actual_updateUndefined}`);
  failed++;
}

// null 插入 → SQL NULL
const createWithNull: InsertOp = {
  type: "insert",
  table: "notes",
  values: {
    id: "abc",
    title: null,    // 写入 NULL
    tags: "[]",
    pinned: 0,
    sort_order: 0,
    created_at: "now",
    updated_at: "now",
    concepts: "[]",
    linked_doc_ids: "[]",
    readonly: 0,
  },
};

// compileInsert 对 null 值：按普通值处理，生成 placeholder
// 实际 SQL 参数绑定层用 json_to_sql_param 把 null → NULL
const expectedSQL_null =
  "INSERT INTO notes (id, title, tags, pinned, sort_order, created_at, updated_at, concepts, linked_doc_ids, readonly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const actual_null = compileInsert(createWithNull);
if (actual_null === expectedSQL_null) {
  console.log("✓ null passed through as placeholder (actual NULL handled by param binding)");
  passed++;
} else {
  console.log("✗ null handling broken");
  console.log(`  Expected: ${expectedSQL_null}`);
  console.log(`  Actual:   ${actual_null}`);
  failed++;
}

console.log(`\n${passed} passed, ${failed} failed (total)`);

// ═══════════════════════════════════════════════════════════════════
// includeDeleted 自动过滤测试
// ═══════════════════════════════════════════════════════════════════

// 默认（不传 includeDeleted）：自动加 deleted_at IS NULL
const selectDefault: SelectOp = {
  type: "select",
  table: "notes",
  columns: ["id", "title"],
  where: [{ col: "date", op: "=", val: "2026-07-15" }],
};

const sqlDefault = compileSelect(selectDefault);
if (sqlDefault === "SELECT id, title FROM notes WHERE date = ? AND deleted_at IS NULL") {
  console.log("✓ auto-filter: deleted_at IS NULL appended by default");
  passed++;
} else {
  console.log("✗ auto-filter: wrong SQL");
  console.log(`  Actual: ${sqlDefault}`);
  failed++;
}

// includeDeleted=true：不加 deleted_at 过滤
const selectDeleted: SelectOp = {
  type: "select",
  table: "notes",
  columns: ["id"],
  includeDeleted: true,
  where: [{ col: "id", op: "=", val: "abc" }],
};

const sqlDeleted = compileSelect(selectDeleted);
if (sqlDeleted === "SELECT id FROM notes WHERE id = ?") {
  console.log("✓ includeDeleted=true: no auto-filter");
  passed++;
} else {
  console.log("✗ includeDeleted=true: wrong SQL");
  console.log(`  Actual: ${sqlDeleted}`);
  failed++;
}

console.log(`\n${passed} passed, ${failed} failed (total)`);
