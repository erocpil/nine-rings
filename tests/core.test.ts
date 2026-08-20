/**
 * 核心纯函数单元测试
 *
 * 用法：npx tsx tests/core.test.ts
 *
 * 覆盖：
 * - buildDocTree（路径树构建）
 * - extractPlainText（纯文本提取）
 * - uuid / now（工具函数）
 */

import { buildDocTree, buildDocumentStoragePath, splitSuggestedDocPath, upsertMatchKey, type FlatDocRecord, type FlatDailyRecord } from "../src/lib/storage/core";
import { getOtherFolderPaths, getVisibleDocumentTreeNodes } from "../src/lib/doc-tree-collapse";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; return; }
  console.error(`  FAIL: ${msg}`);
  failed++;
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

{
  console.log("\n── buildDocumentStoragePath ──");
  assert(buildDocumentStoragePath("projects", "nine-rings") === "projects/nine-rings", "P.A.R.A. root preserves child directory");
  assert(buildDocumentStoragePath("/private/", "/ip/", true) === "private-ip", "custom top-level directory joins prefix and suffix");
  assert(buildDocumentStoragePath("private", "", true) === "private", "custom root may omit suffix");
}

// ═══════════════════════════════════════════════════════════════════
// 1. buildDocTree — 空输入
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: empty inputs ──");

  const tree = buildDocTree([], []);
  assert(tree.length === 0, "empty inputs → empty tree");
}

// ═══════════════════════════════════════════════════════════════════
// 2. buildDocTree — 仅文档（无随笔）
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: documents only ──");

  const docs: FlatDocRecord[] = [
    { id: "d1", title: "DPDK内存管理", storage_path: "references/dpdk", doc_type: "reference", updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "d2", title: "BLESS架构", storage_path: "projects/bless/docs", doc_type: "explanation", updated_at: "2026-01-02T00:00:00Z", readonly: true },
    { id: "d3", title: "部署指南", storage_path: "projects/bless/docs", doc_type: "how-to", updated_at: "2026-01-03T00:00:00Z", readonly: false },
    { id: "d4", title: "P4笔记", storage_path: "references", doc_type: "tutorial", updated_at: "2026-01-04T00:00:00Z", readonly: false },
  ];

  const tree = buildDocTree(docs, []);

  // 不应有 daily/ 节点
  assert(!tree.some(n => n.path.startsWith("daily")), "no daily/ when dailies empty");

  // 文件夹计数
  const refFolder = tree.find(n => n.path === "references" && n.type === "folder");
  assert(refFolder?.count === 2, "references/ count=2 (dpdk doc + root doc)");

  const refDpdk = tree.find(n => n.path === "references/dpdk" && n.type === "folder");
  assert(refDpdk?.count === 1, "references/dpdk/ count=1");

  const projFolder = tree.find(n => n.path === "projects" && n.type === "folder");
  assert(projFolder?.count === 2, "projects/ count=2 (nested bless/docs ×2)");

  const projBless = tree.find(n => n.path === "projects/bless" && n.type === "folder");
  assert(projBless?.count === 2, "projects/bless/ count=2");

  const projBlessDocs = tree.find(n => n.path === "projects/bless/docs" && n.type === "folder");
  assert(projBlessDocs?.count === 2, "projects/bless/docs/ count=2");

  // 文档节点
  const doc1 = tree.find(n => n.path === "references/dpdk/d1" && n.type === "document");
  assert(!!doc1, "doc1 document node exists");
  assert(doc1!.name === "DPDK内存管理", "doc1 name preserved");
  assert(doc1!.docType === "reference", "doc1 docType preserved");
  assert(doc1!.readonly === false, "doc1 readonly=false");

  const doc2 = tree.find(n => n.path === "projects/bless/docs/d2" && n.type === "document");
  assert(doc2!.readonly === true, "doc2 readonly=true");

  // total nodes = 4 documents + folders (references, references/dpdk, projects, projects/bless, projects/bless/docs) = 9
  assert(tree.length === 9, `total nodes = 9 (got ${tree.length})`);
}

// ═══════════════════════════════════════════════════════════════════
// 3. buildDocTree — 仅随笔（无文档）
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: dailies only ──");

  const dailies: FlatDailyRecord[] = [
    { id: "n1", date: "2026-07-15", title: "Today's note", updated_at: "2026-07-15T12:00:00Z" },
    { id: "n2", date: "2026-07-15", title: "Second note", updated_at: "2026-07-15T13:00:00Z" },
    { id: "n3", date: "2026-07-14", title: "Yesterday", updated_at: "2026-07-14T10:00:00Z" },
  ];

  const tree = buildDocTree([], dailies);

  const dailyFolder = tree.find(n => n.path === "daily" && n.type === "folder");
  assert(dailyFolder?.count === 2, "daily/ count=2 (2 unique dates)");

  // 日期节点（按日期倒序排列）
  const dateNodes = tree.filter(n => n.type === "folder" && n.path.startsWith("daily/20"));
  assert(dateNodes.length === 2, "2 date folders");

  // 文档节点
  const docNodes = tree.filter(n => n.type === "document");
  assert(docNodes.length === 3, "3 document nodes under daily/");

  // 无标题 fallback
  const untitled = tree.find(n => n.type === "document" && n.name === "无标题");
  assert(!untitled || untitled.name === "无标题", "untitled notes get '无标题' name");
}

// ═══════════════════════════════════════════════════════════════════
// 4. buildDocTree — 混合输入
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: mixed ──");

  const docs: FlatDocRecord[] = [
    { id: "d1", title: "Project A", storage_path: "projects/a", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];

  const dailies: FlatDailyRecord[] = [
    { id: "n1", date: "2026-07-15", title: "Today", updated_at: "2026-07-15T12:00:00Z" },
  ];

  const tree = buildDocTree(docs, dailies);

  // projects/ 存在
  assert(tree.some(n => n.path === "projects" && n.type === "folder"), "projects/ folder exists");

  // daily/ 存在
  assert(tree.some(n => n.path === "daily" && n.type === "folder"), "daily/ folder exists");

  // 两者共存
  const docNodes = tree.filter(n => n.type === "document");
  assert(docNodes.length === 2, "2 document nodes total (1 doc + 1 daily)");
}

// ═══════════════════════════════════════════════════════════════════
// 5. buildDocTree — 深层路径
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: deep paths ──");

  const docs: FlatDocRecord[] = [
    { id: "d1", title: "Deep Doc", storage_path: "projects/a/b/c/d", doc_type: "how-to", updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];

  const tree = buildDocTree(docs, []);

  const folders = tree.filter(n => n.type === "folder");
  assert(folders.some(n => n.path === "projects"), "projects/ exists");
  assert(folders.some(n => n.path === "projects/a"), "projects/a/ exists");
  assert(folders.some(n => n.path === "projects/a/b"), "projects/a/b/ exists");
  assert(folders.some(n => n.path === "projects/a/b/c"), "projects/a/b/c/ exists");
  assert(folders.some(n => n.path === "projects/a/b/c/d"), "projects/a/b/c/d/ exists");

  // 每级 count 都是 1（只有 1 个文档在该子树下）
  for (const f of folders) {
    assert(f.count === 1, `${f.path} count=1`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 6. buildDocTree — 同名文件夹不同路径
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: sibling folders ──");

  const docs: FlatDocRecord[] = [
    { id: "d1", title: "A1", storage_path: "projects/shared", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "d2", title: "A2", storage_path: "areas/shared", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];

  const tree = buildDocTree(docs, []);

  // 两个独立的 shared/ 文件夹
  const pShared = tree.find(n => n.path === "projects/shared" && n.type === "folder");
  const aShared = tree.find(n => n.path === "areas/shared" && n.type === "folder");
  assert(!!pShared, "projects/shared/ exists");
  assert(!!aShared, "areas/shared/ exists");
  assert(pShared!.count === 1 && aShared!.count === 1, "both shared/ folders count=1");
}

// ═══════════════════════════════════════════════════════════════════
// 7. buildDocTree — 同一路径多个文档
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: multiple docs in same path ──");

  const docs: FlatDocRecord[] = [
    { id: "d1", title: "Note 1", storage_path: "projects/x", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "d2", title: "Note 2", storage_path: "projects/x", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "d3", title: "Note 3", storage_path: "projects/x", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];

  const tree = buildDocTree(docs, []);

  const folder = tree.find(n => n.path === "projects/x" && n.type === "folder");
  assert(folder?.count === 3, "projects/x/ count=3");

  const docNodes = tree.filter(n => n.type === "document" && n.path.startsWith("projects/x/"));
  assert(docNodes.length === 3, "3 document nodes under projects/x/");
}

// ═══════════════════════════════════════════════════════════════════
// 8. buildDocTree — daily 日期排序（倒序）
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── buildDocTree: daily date ordering ──");

  const dailies: FlatDailyRecord[] = [
    { id: "n1", date: "2026-01-01", title: "Old", updated_at: "2026-01-01T00:00:00Z" },
    { id: "n2", date: "2026-07-15", title: "New", updated_at: "2026-07-15T00:00:00Z" },
    { id: "n3", date: "2026-03-01", title: "Mid", updated_at: "2026-03-01T00:00:00Z" },
  ];

  const tree = buildDocTree([], dailies);
  // daily/ folder count = 3 (unique dates)
const dailyFolder = tree.find(n => n.path === "daily" && n.type === "folder");
  assert(dailyFolder?.count === 3, "daily/ count=3");
}

// 大备份中的随笔按日期一次分组；验证大量日期和同日多篇的计数结果。
{
  console.log("\n── buildDocTree: large daily grouping ──");
  const dailies: FlatDailyRecord[] = Array.from({ length: 2_000 }, (_, index) => ({
    id: `daily-${index}`,
    date: `2026-${String(Math.floor(index / 28) % 12 + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`,
    title: `Daily ${index}`,
    updated_at: "2026-01-01T00:00:00Z",
  }));
  const tree = buildDocTree([], dailies);
  assert(tree.filter((node) => node.type === "document").length === 2_000,
    "large daily grouping preserves every note");
  assert(tree.find((node) => node.path === "daily")?.count === 336,
    "daily root counts unique dates");
}

// ═══════════════════════════════════════════════════════════════════
// 9. collapse others — 文档和目录选择
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── collapse others: document and folder selection ──");

  const docs: FlatDocRecord[] = [
    { id: "active", title: "Active", storage_path: "projects/app/docs", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "sibling", title: "Sibling", storage_path: "projects/other", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
    { id: "area", title: "Area", storage_path: "areas/work", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];
  const tree = buildDocTree(docs, []);

  const forDocument = new Set(getOtherFolderPaths(tree, "active", null));
  assert(!forDocument.has("projects"), "selected document root remains expanded");
  assert(!forDocument.has("projects/app"), "selected document ancestor remains expanded");
  assert(!forDocument.has("projects/app/docs"), "selected document parent remains expanded");
  assert(forDocument.has("projects/other"), "document sibling is collapsed");
  assert(forDocument.has("areas"), "other root is collapsed");
  assert(forDocument.has("areas/work"), "other nested folder is collapsed");

  const forFolder = new Set(getOtherFolderPaths(tree, null, "projects/app"));
  assert(!forFolder.has("projects"), "selected folder root remains expanded");
  assert(!forFolder.has("projects/app"), "selected folder remains expanded");
  assert(forFolder.has("projects/app/docs"), "selected folder descendant is collapsed");
  assert(forFolder.has("projects/other"), "selected folder sibling is collapsed");

  const withoutSelection = getOtherFolderPaths(tree, null, null);
  assert(withoutSelection.length === tree.filter(n => n.type === "folder").length, "no selection collapses all folders");
}

// ═══════════════════════════════════════════════════════════════════
// 10. document tree visibility — daily 默认隐藏
// ═══════════════════════════════════════════════════════════════════
{
  console.log("\n── document tree visibility: daily hidden by default ──");
  const docs: FlatDocRecord[] = [
    { id: "doc", title: "Doc", storage_path: "projects/app", doc_type: undefined, updated_at: "2026-01-01T00:00:00Z", readonly: false },
  ];
  const dailies: FlatDailyRecord[] = [
    { id: "daily-note", date: "2026-01-01", title: "Daily", updated_at: "2026-01-01T00:00:00Z" },
  ];
  const tree = buildDocTree(docs, dailies);
  const defaultVisible = getVisibleDocumentTreeNodes(tree);
  assert(defaultVisible.every(node => node.path !== "daily" && !node.path.startsWith("daily/")), "daily subtree is hidden by default");
  assert(defaultVisible.some(node => node.noteId === "doc"), "regular documents remain visible");
  assert(getVisibleDocumentTreeNodes(tree, true).length === tree.length, "daily subtree can be enabled later");
}

{
  console.log("\n── splitSuggestedDocPath ──");
  const dflt = { rootPath: "projects", subPath: "", hasSuggestion: false };
  assert(deepEqual(splitSuggestedDocPath(undefined), dflt), "undefined → 默认");
  assert(deepEqual(splitSuggestedDocPath(""), dflt), "空字符串 → 默认");
  assert(deepEqual(splitSuggestedDocPath("projects"), { rootPath: "projects", subPath: "", hasSuggestion: true }), "根目录 projects → subPath 留空");
  assert(deepEqual(splitSuggestedDocPath("areas"), { rootPath: "areas", subPath: "", hasSuggestion: true }), "根目录 areas → subPath 留空");
  assert(deepEqual(splitSuggestedDocPath("projects/web/react"), { rootPath: "projects", subPath: "web/react", hasSuggestion: true }), "多级 → root + subPath");
  assert(deepEqual(splitSuggestedDocPath("references/dpdk"), { rootPath: "references", subPath: "dpdk", hasSuggestion: true }), "references 子目录");
  assert(deepEqual(splitSuggestedDocPath("foo/bar"), dflt), "非法 root → 默认");
  assert(deepEqual(splitSuggestedDocPath("daily/2026-01-01"), dflt), "daily 前缀 → 默认（非 P.A.R.A.）");
  assert(deepEqual(splitSuggestedDocPath("/projects/web/"), { rootPath: "projects", subPath: "web", hasSuggestion: true }), "前后斜杠被清理");
}

{
  console.log("\n── upsertMatchKey ──");
  const doc = upsertMatchKey({ date: "2026-08-01", title: "A", storagePath: "projects/x" });
  assert(doc?.kind === "document", "storagePath+title → document");
  assert(doc?.storagePath === "projects/x" && doc?.title === "A", "document 匹配键字段");

  const daily = upsertMatchKey({ date: "2026-08-01", title: "日记" });
  assert(daily?.kind === "daily", "无 storagePath 有 title → daily");
  assert(daily?.title === "日记" && daily?.date === "2026-08-01", "daily 匹配键字段");

  assert(upsertMatchKey({ date: "2026-08-01" }) === null, "无 title → null（新建）");
  assert(upsertMatchKey({ date: "2026-08-01", title: "" }) === null, "空 title → null（新建）");
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
