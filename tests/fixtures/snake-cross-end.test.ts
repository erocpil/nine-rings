/**
 * 跨端字段命名等价性测试
 *
 * 验证 snake_case (Rust/SQLite) 和 camelCase (Web/IDB) 两种格式
 * 经 normalize.ts 处理后产生等价的 Note 对象。
 *
 * 运行：tsx tests/fixtures/snake-cross-end.test.ts
 */

import { snakeNoteToCamel, snakeImportToCamel } from "../../src/lib/storage/normalize";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// ═══════════════════════════════════════════════════════════════════
// Fixture: 同一篇笔记的两种表示
// ═══════════════════════════════════════════════════════════════════

const snakeRow = {
  id: "cross-end-001",
  date: "2026-07-28",
  title: "跨端测试文档",
  content: JSON.stringify({ ops: [{ insert: "Hello 世界\n" }] }),
  search_text: "hello 世界",
  tags: JSON.stringify(["文档", "测试"]),
  pinned: 1,
  sort_order: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-07-28T12:00:00Z",
  storage_path: "projects/cross-end",
  doc_type: "how-to",
  concepts: JSON.stringify(["跨端", "字段"]),
  linked_doc_ids: JSON.stringify(["doc-001", "doc-002"]),
  readonly: 0,
};

const snakeImport = {
  id: "cross-end-001",
  date: "2026-07-28",
  title: "跨端测试文档",
  content: { ops: [{ insert: "Hello 世界\n" }] },
  tags: ["文档", "测试"],
  pinned: true,
  sort_order: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-07-28T12:00:00Z",
  storage_path: "projects/cross-end",     // Rust serde 导出格式
  doc_type: "how-to",
  concepts: ["跨端", "字段"],
  linked_doc_ids: ["doc-001", "doc-002"],
  readonly: false,
};

const camelImport = {
  id: "cross-end-001",
  date: "2026-07-28",
  title: "跨端测试文档",
  content: { ops: [{ insert: "Hello 世界\n" }] },
  tags: ["文档", "测试"],
  pinned: true,
  sort_order: 3,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-07-28T12:00:00Z",
  storagePath: "projects/cross-end",      // Web IDB 导出格式
  docType: "how-to",
  concepts: ["跨端", "字段"],
  linkedDocIds: ["doc-001", "doc-002"],
  readonly: false,
};

// ═══════════════════════════════════════════════════════════════════
// 测试 1: snakeNoteToCamel — SQL 行 → Note
// ═══════════════════════════════════════════════════════════════════

console.log("\n── snakeNoteToCamel ──");

const note = snakeNoteToCamel(snakeRow);

assert(note.id === "cross-end-001", "id 保留");
assert(note.title === "跨端测试文档", "title 含 Unicode");
assert(note.storagePath === "projects/cross-end", "storage_path → storagePath");
assert(note.docType === "how-to", "doc_type → docType");
assert(note.pinned === true, "pinned: 1 → true");
assert(note.readonly === false, "readonly: 0 → false");
assert(note.sort_order === 3, "sort_order 保留");
assert(note.tags.length === 2, "tags 解析为数组");
assert(note.tags[0] === "文档", "tags[0] 正确");
assert(note.concepts!.length === 2, "concepts 解析为数组");
assert(note.concepts![0] === "跨端", "concepts[0] 含 Unicode");
assert(note.linkedDocIds!.length === 2, "linkedDocIds 解析为数组");
assert(note.linkedDocIds![0] === "doc-001", "linkedDocIds[0] 正确");
assert(typeof note.content === "object", "content 为对象（非字符串）");

// ═══════════════════════════════════════════════════════════════════
// 测试 2: 两种导入格式等效
// ═══════════════════════════════════════════════════════════════════

console.log("\n── snakeImportToCamel: 两种格式等效 ──");

const fromSnake = snakeImportToCamel(snakeImport);
const fromCamel = snakeImportToCamel(camelImport);

assert(fromSnake.storagePath === "projects/cross-end", "snake → storagePath");
assert(fromCamel.storagePath === "projects/cross-end", "camel → storagePath");
assert(fromSnake.docType === "how-to", "snake → docType");
assert(fromCamel.docType === "how-to", "camel → docType");
assert(fromSnake.linkedDocIds!.length === 2, "snake → linkedDocIds 有 2 项");
assert(fromCamel.linkedDocIds!.length === 2, "camel → linkedDocIds 有 2 项");

// snake_case 原始 key 已被删除
assert(fromSnake.storage_path === undefined, "snake 原始 storage_path 被删除");
assert(fromCamel.storagePath !== undefined, "camel storagePath 保留");
assert(fromSnake.doc_type === undefined, "snake 原始 doc_type 被删除");
assert(fromCamel.docType !== undefined, "camel docType 保留");

// ═══════════════════════════════════════════════════════════════════
// 测试 3: 边界情况
// ═══════════════════════════════════════════════════════════════════

console.log("\n── 边界情况 ──");

// 3a: null fields
const nullSnake = snakeNoteToCamel({
  id: "nulls-001", date: "2026-01-01", title: null,
  content: "{}", tags: "[]", pinned: 0, sort_order: 0,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  storage_path: null, doc_type: null, concepts: "[]", linked_doc_ids: "[]", readonly: 0,
});
assert(nullSnake.storagePath === undefined, "null storage_path → undefined storagePath");
assert(nullSnake.docType === undefined, "null doc_type → undefined docType");

// 3b: boolean pinned/readonly (not integer)
const boolRow = snakeNoteToCamel({
  id: "bool-001", date: "2026-01-01", title: "test",
  content: "{}", tags: "[]", pinned: true, sort_order: 0,
  created_at: "", updated_at: "",
  readonly: false,
});
assert(boolRow.pinned === true, "boolean pinned 保留");
assert(boolRow.readonly === false, "boolean readonly 保留");

// 3c: 空字符串 JSON
const emptyConcepts = snakeNoteToCamel({
  id: "empty-001", date: "2026-01-01", title: null,
  content: "{}", tags: "[]", pinned: 0, sort_order: 0,
  created_at: "", updated_at: "",
  concepts: "[]", linked_doc_ids: "[]", readonly: 0,
});
assert(emptyConcepts.concepts!.length === 0, "concepts 空数组");
assert(emptyConcepts.linkedDocIds!.length === 0, "linkedDocIds 空数组");

// 3d: concepts/linked_doc_ids missing
const missingFields = snakeNoteToCamel({
  id: "missing-001", date: "2026-01-01", title: "test",
  content: "{}", tags: "[]", pinned: 0, sort_order: 0,
  created_at: "", updated_at: "", readonly: 0,
});
assert(missingFields.concepts === undefined, "缺失 concepts → undefined");
assert(missingFields.linkedDocIds === undefined, "缺失 linked_doc_ids → undefined");

// 3e: 混合格式 — snake 和 camel 都存在，snakeImportToCamel 优先保留 camel
const mixed = snakeImportToCamel({
  storage_path: "from-rust",
  storagePath: "from-web",   // 两个都存在（camelCase 已存在时不覆盖）
  doc_type: "how-to",
  linked_doc_ids: ["a"],
  linkedDocIds: ["b"],
});
assert(mixed.storagePath === "from-web", "混合: 保留已有 camelCase storagePath");
assert(mixed.linkedDocIds[0] === "b", "混合: 保留已有 camelCase linkedDocIds");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
