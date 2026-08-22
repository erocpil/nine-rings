import {
  collectMoveFolderPaths,
  getDocumentFolderPath,
  getPathAncestors,
  resolveMoveTarget,
  type MoveToSubject,
} from "../src/lib/move-to";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function throws(fn: () => unknown, label: string) {
  try {
    fn();
    assert(false, label);
  } catch {
    assert(true, label);
  }
}

console.log("\n── MoveTo：目标路径解析 ──");

const documentSubject: MoveToSubject = {
  kind: "document",
  noteId: "note-1",
  title: "文档",
  currentPath: "projects/nine-rings",
};

assert(
  resolveMoveTarget(documentSubject, " archives \\ old ") === "archives/old",
  "文档目标目录会统一斜杠并去除多余空白",
);
throws(
  () => resolveMoveTarget(documentSubject, "projects/nine-rings"),
  "文档不能移动到当前位置",
);
assert(
  resolveMoveTarget({ kind: "documents", noteIds: ["note-1", "note-2"], count: 2 }, "new/archive") === "new/archive",
  "多个文档可移动到尚不存在的新目录",
);

const folderSubject: MoveToSubject = {
  kind: "folder",
  sourcePath: "projects/nine-rings",
  documentCount: 3,
};

assert(
  resolveMoveTarget(folderSubject, "archives") === "archives/nine-rings",
  "目录选择目标父目录并保留原目录名",
);
assert(
  resolveMoveTarget(folderSubject, "") === "nine-rings",
  "目录可以移动到文档树根级",
);
throws(
  () => resolveMoveTarget(folderSubject, "projects"),
  "目录不能移动到当前父目录",
);
throws(
  () => resolveMoveTarget(folderSubject, "projects/nine-rings/child"),
  "目录不能移动到自身的后代目录",
);

const folders = collectMoveFolderPaths([
  "daily",
  "daily/2026-08-21",
  "custom \\ nested",
  "projects/nine-rings",
]);
assert(folders.includes("archives") && folders.includes("areas"), "始终提供 P.A.R.A. 顶层目录");
assert(folders.includes("custom/nested"), "保留并规范化自定义目录");
assert(!folders.some((path) => path === "daily" || path.startsWith("daily/")), "排除 daily 虚拟目录");

assert(
  getDocumentFolderPath("projects/nine-rings/note-1", "note-1") === "projects/nine-rings",
  "从文档树节点路径还原 storagePath",
);
assert(
  JSON.stringify(getPathAncestors("archives/nine-rings/old"))
    === JSON.stringify(["archives", "archives/nine-rings", "archives/nine-rings/old"]),
  "生成目标目录的全部祖先路径",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
