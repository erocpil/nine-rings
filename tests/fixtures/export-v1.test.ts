/**
 * export-v1.json fixture 验证测试
 *
 * 验证：
 * 1. fixture 可被导入（字段归一化正确）
 * 2. 再次导出后关键字段一致
 * 3. 覆盖所有文档类型、null/空数组、Unicode 等边界
 *
 * 运行：tsx tests/fixtures/export-v1.test.ts
 */

import "fake-indexeddb/auto";
import { api } from "../../src/lib/api";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

async function main() {
  console.log("\n── export-v1 fixture 导入/导出 round-trip ──")

  const fixture = await import("./export-v1.json", { with: { type: "json" } });
  const { notes, daily_pages } = fixture.default ?? fixture;

  // ── 导入 ──
  const json = JSON.stringify(fixture.default ?? fixture);
  console.log("导入 fixture...");
  const result = await api.export.import(json);
  console.log(`导入完成: ${result.notes_imported} notes, ${result.pages_imported} pages`);
  assert(result.notes_imported === 8, `导入 8 篇笔记`);
  assert(result.pages_imported === 2, `导入 2 个 daily page`);

  // ── 验证文档字段 ──
  const doc = await api.notes.get("fixture-doc-howto-001");
  assert(doc !== null, "文档可读取");
  if (doc) {
    assert(doc.storagePath === "areas/nine-rings", `storagePath 正确: ${doc.storagePath}`);
    assert(doc.docType === "how-to", `docType 正确: ${doc.docType}`);
    assert(Array.isArray(doc.concepts), "concepts 是数组");
    assert(doc.concepts!.includes("GitHub"), "concepts 包含 GitHub");
    assert(doc.concepts!.includes("备份"), "concepts 包含 备份（Unicode）");
    assert(Array.isArray(doc.linkedDocIds), "linkedDocIds 是数组");
    assert(doc.linkedDocIds!.includes("fixture-doc-reference-001"), "linkedDocIds 包含关联文档");
    assert(doc.pinned === true, "pinned = true");
    assert(doc.readonly === false, "readonly = false");
    assert(doc.title === "如何配置 GitHub 备份", "title 含 Unicode");
  }

  // ── readonly 文档 ──
  const refDoc = await api.notes.get("fixture-doc-reference-001");
  assert(refDoc !== null, "只读文档可读取");
  if (refDoc) {
    assert(refDoc.readonly === true, "readonly = true");
    assert(refDoc.linkedDocIds?.length === 0, "linkedDocIds 空数组");
  }

  // ── null fields ──
  const noType = await api.notes.get("fixture-doc-no-type-001");
  assert(noType !== null, "无类型文档可读取");
  if (noType) {
    assert(noType.docType === null || noType.docType === undefined, "docType 为 null/undefined");
    assert(Array.isArray(noType.concepts) && noType.concepts.length === 0, "concepts 空数组");
  }

  // ── linkedDocIds = null ──
  const explanation = await api.notes.get("fixture-doc-explanation-001");
  assert(explanation !== null, "explanation 文档可读取");
  if (explanation) {
    const hasNull = explanation.linkedDocIds === null || explanation.linkedDocIds === undefined || explanation.linkedDocIds.length === 0;
    assert(hasNull, "linkedDocIds 可为 null（原始 fixture 中为 null）");
  }

  // ── 普通随笔（无 storagePath）──
  const essay = await api.notes.get("fixture-normal-note-001");
  assert(essay !== null, "随笔可读取");
  if (essay) {
    assert(!essay.storagePath, "随笔无 storagePath");
    assert(essay.tags.includes("随笔"), "tags 包含 Unicode");
  }

  // ── 空标题随笔 ──
  const emptyEssay = await api.notes.get("fixture-essay-empty-001");
  assert(emptyEssay !== null, "空标题随笔可读取");
  if (emptyEssay) {
    assert(emptyEssay.title === "" || emptyEssay.title === null, "空标题正确");
    assert(emptyEssay.tags === null || (Array.isArray(emptyEssay.tags) && emptyEssay.tags.length === 0), "null tags 正确处理");
  }

  // ── 深层路径 ──
  const deep = await api.notes.get("fixture-doc-deep-path-001");
  assert(deep !== null, "深层路径文档可读取");
  if (deep) {
    assert(deep.storagePath === "projects/web/frontend/react", "深层 storagePath 正确");
  }

  // ── Daily pages ──
  const dp = await api.daily.get("2026-07-28");
  assert(dp !== null, "daily page 可读取");
  if (dp) {
    assert(dp.todos.length === 3, "todos 有 3 项");
    assert(dp.todos[0].done === true, "第一个 todo 已完成");
    assert(dp.todos[2].text === "", "空文本 todo 保留");
    assert(dp.todo_carryover === true, "carryover = true");
  }

  // ── 再次导出 ──
  console.log("\n再次导出...");
  const exported = await api.export.data();
  const reData = JSON.parse(exported);
  assert(reData.notes.length === 8, "重新导出 8 篇笔记");
  assert(reData.daily_pages.length === 2, "重新导出 2 个 daily page");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
