/**
 * App 级快捷键纯函数测试
 *
 * 覆盖：快捷键映射（resolveShortcut）、可编辑目标判断（isEditableTarget）、
 * 编辑态忽略守卫（shouldIgnoreShortcut）。
 *
 * 运行：tsx tests/shortcuts.test.ts
 */

import {
  resolveShortcut,
  isDocumentFindShortcut,
  isDocumentFindKeyEvent,
  isEditorLineJumpKeyEvent,
  isEditorLineJumpShortcut,
  isEditableTarget,
  shouldIgnoreShortcut,
} from "../src/lib/shortcuts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// 构造最小键盘事件
function key(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}) {
  return {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  };
}

console.log("\n── resolveShortcut：快捷键映射 ──");

assert(resolveShortcut(key({ key: "F11" })) === "fullscreen", "F11 → fullscreen");
assert(resolveShortcut(key({ key: "F11", ctrlKey: true })) === null, "Ctrl+F11 不映射（非纯 F11）");
assert(resolveShortcut(key({ key: ",", altKey: true })) === "openSettings", "Alt+, → openSettings");
assert(resolveShortcut(key({ key: ",", ctrlKey: true })) === null, "Ctrl+, 不映射");
assert(resolveShortcut(key({ key: "e", ctrlKey: true })) === null, "Ctrl+E 放行给编辑器");
assert(resolveShortcut(key({ key: "E", ctrlKey: true })) === null, "Ctrl+E（大写）放行给编辑器");
assert(resolveShortcut(key({ key: "e", metaKey: true })) === null, "Meta+E（macOS）放行给编辑器");
assert(resolveShortcut(key({ key: "f", ctrlKey: true, shiftKey: true })) === "focusSearch", "Ctrl+Shift+F → focusSearch");
assert(resolveShortcut(key({ key: "d", ctrlKey: true, shiftKey: true })) === "goToDaily", "Ctrl+Shift+D → goToDaily");
assert(resolveShortcut(key({ key: "x", ctrlKey: true, shiftKey: true })) === null, "Ctrl+Shift+X 放行给编辑器");
assert(resolveShortcut(key({ key: "b", ctrlKey: true })) === null, "Ctrl+B 放行给编辑器（加粗）");
assert(resolveShortcut(key({ key: "e" })) === null, "无修饰 e 不映射");
assert(resolveShortcut(key({ key: "e", altKey: true })) === "focusSearch", "Alt+E → focusSearch");
assert(resolveShortcut(key({ key: "E", altKey: true })) === "focusSearch", "Alt+E（大写）→ focusSearch");

assert(isDocumentFindShortcut("CommandOrControl+F") === true, "CommandOrControl+F 仍是编辑器保留键");
assert(isDocumentFindShortcut("Ctrl + F") === true, "Ctrl+F 保留给 Vim 翻页");
assert(isDocumentFindShortcut("Alt+F") === true, "Alt+F 保留给文档查找");
assert(isDocumentFindKeyEvent(key({ key: "f", ctrlKey: true })) === false, "Ctrl+F 不再打开文档查找");
assert(isDocumentFindKeyEvent(key({ key: "F", metaKey: true })) === true, "Cmd+F 打开文档查找");
assert(isDocumentFindKeyEvent(key({ key: "f", altKey: true })) === true, "Alt+F 打开文档查找");
assert(isDocumentFindKeyEvent(key({ key: "f", ctrlKey: true, altKey: true })) === false,
  "Ctrl+Alt+F 不误触文档查找");
assert(isDocumentFindKeyEvent(key({ key: "f", ctrlKey: true, shiftKey: true })) === false,
  "Ctrl+Shift+F 仍留给全局搜索");
assert(isEditorLineJumpShortcut("Alt + G") === true, "Alt+G 保留给编辑器行号跳转");
assert(isEditorLineJumpKeyEvent(key({ key: "g", altKey: true })) === true, "Alt+G 打开行号跳转");
assert(isEditorLineJumpKeyEvent(key({ key: "G", altKey: true, shiftKey: true })) === false,
  "Alt+Shift+G 不误触行号跳转");

console.log("\n── isEditableTarget：可编辑目标判断 ──");

assert(isEditableTarget(null) === false, "null → false");
assert(isEditableTarget(undefined) === false, "undefined → false");
assert(isEditableTarget({}) === false, "空对象 → false");
assert(isEditableTarget({ tagName: "DIV" }) === false, "DIV → false");
assert(isEditableTarget({ tagName: "P" }) === false, "P → false");
assert(isEditableTarget({ tagName: "INPUT" }) === true, "INPUT → true");
assert(isEditableTarget({ tagName: "input" }) === true, "input（小写）→ true");
assert(isEditableTarget({ tagName: "TEXTAREA" }) === true, "TEXTAREA → true");
assert(isEditableTarget({ tagName: "SELECT" }) === true, "SELECT → true");
assert(isEditableTarget({ isContentEditable: true }) === true, "contenteditable → true");
assert(isEditableTarget({ tagName: "DIV", isContentEditable: true }) === true, "contenteditable div → true");

console.log("\n── shouldIgnoreShortcut：编辑态忽略守卫 ──");

const editable = { isContentEditable: true };
const plain = { tagName: "DIV" };

assert(shouldIgnoreShortcut(key({ key: "e", altKey: true }), editable) === false, "Alt+E 在编辑态不忽略");
assert(shouldIgnoreShortcut(key({ key: ",", altKey: true }), editable) === false, "Alt+, 在编辑态不忽略");
assert(shouldIgnoreShortcut(key({ key: "F11" }), editable) === false, "F11 功能键在编辑态不忽略");
assert(shouldIgnoreShortcut(key({ key: "e" }), editable) === true, "无修饰 e 在编辑态忽略");
assert(shouldIgnoreShortcut(key({ key: "n" }), editable) === true, "无修饰 n 在编辑态忽略");
assert(shouldIgnoreShortcut(key({ key: "e" }), plain) === false, "无修饰 e 在非编辑态不忽略");
assert(shouldIgnoreShortcut(key({ key: "n" }), { tagName: "INPUT" }) === true, "无修饰 n 在 input 内忽略");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
