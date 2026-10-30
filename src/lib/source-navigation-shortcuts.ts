import { expandSourceSelection, shrinkSourceSelection, jumpSourceBracket, jumpSourceWord, jumpSourceStructure } from "./source-structural-navigation";
import { repeatSourceEdit, selectSourceObject } from "./source-navigation-actions";
import type { EditorView } from "@codemirror/view";
export const SOURCE_SHORTCUT_EVENT = "nine-rings:source-shortcuts";
export const sourceCommands = [
  { id: "expand", label: "扩大结构选区", key: "Alt-F1", run: expandSourceSelection },
  { id: "shrink", label: "缩小结构选区", key: "Alt-Shift-F1", run: shrinkSourceSelection },
  { id: "bracket", label: "跳转配对括号", key: "Mod-Shift-\\", run: jumpSourceBracket },
  { id: "nextWord", label: "下一处同词", key: "Alt-F3", run: (v: EditorView) => jumpSourceWord(v, 1) },
  { id: "previousWord", label: "上一处同词", key: "Alt-Shift-F3", run: (v: EditorView) => jumpSourceWord(v, -1) },
  { id: "previousStructure", label: "上一同级或外层行", key: "", run: (v: EditorView) => jumpSourceStructure(v, -1) },
  { id: "nextStructure", label: "下一同级或外层行", key: "", run: (v: EditorView) => jumpSourceStructure(v, 1) },
  { id: "outerStructure", label: "跳到外层缩进", key: "", run: (v: EditorView) => jumpSourceStructure(v, -1, true) },
  { id: "brackets", label: "选择括号内文本", key: "", run: (v: EditorView) => selectSourceObject(v, "brackets") },
  { id: "quote", label: "选择引号内文本", key: "", run: (v: EditorView) => selectSourceObject(v, "quote") },
  { id: "function", label: "选择整个函数", key: "", run: (v: EditorView) => selectSourceObject(v, "function") },
  { id: "repeat", label: "重复上次简单编辑", key: "", run: repeatSourceEdit },
];
export function sourceShortcutSettings(): Record<string, string> {
  let saved: Record<string, string> = {};
  try { saved = JSON.parse(localStorage.getItem("nr:source-shortcuts") ?? "{}"); } catch { /* Defaults. */ }
  return Object.fromEntries(sourceCommands.map(command => [command.id, typeof saved?.[command.id] === "string" && /^(?:Alt-(?:Shift-)?F(?:[1-9]|1[0-2])|Mod-Shift-\\)?$/.test(saved[command.id]) ? saved[command.id] : command.key]));
}
export function saveSourceShortcuts(settings: Record<string, string>) {
  localStorage.setItem("nr:source-shortcuts", JSON.stringify(settings));
  window.dispatchEvent(new Event(SOURCE_SHORTCUT_EVENT));
}
export function sourceNavigationKeybindings() {
  const settings = sourceShortcutSettings();
  return sourceCommands.filter(command => settings[command.id]).map(command => ({ key: settings[command.id], run: command.run }));
}
