import { Extension, type Editor } from "@tiptap/core";
import { redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  headingFoldPluginKey,
  toggleHeadingFoldInView,
  type HeadingFoldState,
} from "./HeadingFold";
import {
  collapsedHeadingContentRanges,
  extractHeadingSections,
  headingSectionAtPosition,
} from "../lib/heading-fold";
import { jumpToNamedBookmarkInView, setNamedBookmarkInView } from "./DocumentBookmarks";

export type VimEditorMode = "normal" | "insert" | "visual" | "visual-line";

interface VimPluginState {
  enabled: boolean;
  readOnly: boolean;
  mode: VimEditorMode;
  count: string;
  pending: "" | "d" | "y" | "g" | "m" | "'";
  visualAnchor: number | null;
}

type VimMeta = Partial<VimPluginState>;

interface VimRegister {
  slice: Slice;
  linewise: boolean;
}

export interface VimModeOptions {
  enabled: boolean;
  readOnly: boolean;
  onModeChange?: (mode: VimEditorMode) => void;
  onSearch?: (direction: 1 | -1 | 0) => void;
}

export const vimModePluginKey = new PluginKey<VimPluginState>("nineRingsVimMode");

const initialState = (enabled: boolean, readOnly: boolean): VimPluginState => ({
  enabled,
  readOnly,
  mode: enabled ? "normal" : "insert",
  count: "",
  pending: "",
  visualAnchor: null,
});

function topLevelBlocks(doc: ProseMirrorNode) {
  const blocks: Array<{ node: ProseMirrorNode; pos: number }> = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  return blocks;
}

interface VimNavigationLine {
  from: number;
  to: number;
  text: string;
}

interface VimWordSegment {
  from: number;
  to: number;
}

const navigationLineCache = new WeakMap<ProseMirrorNode, VimNavigationLine[]>();
const wordSegmentCache = new WeakMap<ProseMirrorNode, VimWordSegment[]>();
const visibleNavigationCache = new WeakMap<HeadingFoldState, {
  lines: VimNavigationLine[];
  words: VimWordSegment[];
}>();

/**
 * Vim 的逻辑行对应可编辑 textblock，而不是 ProseMirror 顶层节点。
 * 因此列表项和表格单元格可以逐行进入，HR 等原子块会被自然跨过。
 * 文档节点不可变，按 doc 实例缓存后，连续移动不会反复遍历长文档。
 */
function navigationLines(doc: ProseMirrorNode): VimNavigationLine[] {
  const cached = navigationLineCache.get(doc);
  if (cached) return cached;
  const lines: VimNavigationLine[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    lines.push({
      from: pos + 1,
      to: pos + node.nodeSize - 1,
      text: node.textBetween(0, node.content.size, "\n", "\ufffc"),
    });
    return false;
  });
  navigationLineCache.set(doc, lines);
  return lines;
}

function visibleNavigation(state: EditorState) {
  const folded = headingFoldPluginKey.getState(state);
  if (!folded || folded.collapsedKeys.size === 0) {
    return { lines: navigationLines(state.doc), words: wordSegments(state.doc) };
  }
  const cached = visibleNavigationCache.get(folded);
  if (cached) return cached;
  const ranges = collapsedHeadingContentRanges(state.doc, folded.collapsedKeys);
  const filterVisible = <T extends { from: number }>(items: T[]): T[] => {
    let rangeIndex = 0;
    return items.filter((item) => {
      while (rangeIndex < ranges.length && item.from >= ranges[rangeIndex].to) rangeIndex += 1;
      const range = ranges[rangeIndex];
      return !range || item.from < range.from || item.from >= range.to;
    });
  };
  const visible = {
    lines: filterVisible(navigationLines(state.doc)),
    words: filterVisible(wordSegments(state.doc)),
  };
  visibleNavigationCache.set(folded, visible);
  return visible;
}

function navigationLineIndex(state: EditorState, position: number): number {
  const lines = visibleNavigation(state).lines;
  if (lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (position < line.from) high = middle - 1;
    else if (position > line.to) low = middle + 1;
    else return middle;
  }
  if (low <= 0) return 0;
  if (low >= lines.length) return lines.length - 1;
  return position - lines[low - 1].to <= lines[low].from - position ? low - 1 : low;
}

function positionInNavigationLine(state: EditorState, lineIndex: number, preferredOffset: number): number {
  const lines = visibleNavigation(state).lines;
  const line = lines[Math.max(0, Math.min(lines.length - 1, lineIndex))];
  if (!line) return state.selection.head;
  return Math.max(line.from, Math.min(line.to, line.from + preferredOffset));
}

function vimCharacterClass(character: string): "keyword" | "cjk" | "punct" | "space" {
  if (/\s/u.test(character)) return "space";
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)) return "cjk";
  if (/[\p{L}\p{N}_]/u.test(character)) return "keyword";
  return "punct";
}

function wordSegments(doc: ProseMirrorNode): VimWordSegment[] {
  const cached = wordSegmentCache.get(doc);
  if (cached) return cached;
  const segments: VimWordSegment[] = [];
  for (const line of navigationLines(doc)) {
    let offset = 0;
    while (offset < line.text.length) {
      const character = String.fromCodePoint(line.text.codePointAt(offset)!);
      const kind = vimCharacterClass(character);
      if (kind === "space") {
        offset += character.length;
        continue;
      }
      const start = offset;
      offset += character.length;
      while (offset < line.text.length) {
        const next = String.fromCodePoint(line.text.codePointAt(offset)!);
        if (vimCharacterClass(next) !== kind) break;
        offset += next.length;
      }
      segments.push({ from: line.from + start, to: line.from + offset });
    }
  }
  wordSegmentCache.set(doc, segments);
  return segments;
}

function wordMotionPosition(
  state: EditorState,
  direction: "word-forward" | "word-back" | "word-end",
  count: number,
): number {
  const { lines, words: segments } = visibleNavigation(state);
  if (segments.length === 0) return state.selection.head;
  let position = state.selection.head;
  for (let step = 0; step < count; step += 1) {
    if (direction === "word-forward") {
      position = segments.find((segment) => segment.from > position)?.from ?? lines[lines.length - 1].to;
    } else if (direction === "word-back") {
      const current = segments.find((segment) => position > segment.from && position <= segment.to);
      if (current) position = current.from;
      else position = [...segments].reverse().find((segment) => segment.from < position)?.from ?? segments[0].from;
    } else {
      const target = segments.find((segment) => segment.to - 1 > position);
      const last = segments[segments.length - 1];
      position = target ? Math.max(target.from, target.to - 1) : Math.max(last.from, last.to - 1);
    }
  }
  return position;
}

function currentBlockIndex(state: EditorState): number {
  return Math.max(0, Math.min(state.doc.childCount - 1, state.selection.$head.index(0)));
}

function firstTextPosition(node: ProseMirrorNode, nodePos: number): number {
  if (node.isTextblock) return nodePos + 1;
  let found: number | null = null;
  node.descendants((child, relativePos) => {
    if (found !== null) return false;
    if (child.isTextblock) {
      found = nodePos + 1 + relativePos + 1;
      return false;
    }
    return true;
  });
  return found ?? Math.min(nodePos + 1, nodePos + node.nodeSize - 1);
}

function lastTextPosition(node: ProseMirrorNode, nodePos: number): number {
  if (node.isTextblock) return nodePos + node.nodeSize - 1;
  let found: number | null = null;
  node.descendants((child, relativePos) => {
    if (child.isTextblock) found = nodePos + 1 + relativePos + child.nodeSize - 1;
    return true;
  });
  return found ?? Math.max(nodePos + 1, nodePos + node.nodeSize - 1);
}

function positionInBlock(
  state: EditorState,
  blockIndex: number,
  preferredOffset: number,
): number {
  const blocks = topLevelBlocks(state.doc);
  const block = blocks[Math.max(0, Math.min(blocks.length - 1, blockIndex))];
  if (!block) return state.selection.head;
  const start = firstTextPosition(block.node, block.pos);
  const end = lastTextPosition(block.node, block.pos);
  return Math.max(start, Math.min(end, start + preferredOffset));
}

function dispatchSelection(
  view: EditorView,
  position: number,
  vim: VimPluginState,
  scroll = true,
) {
  const pos = Math.max(0, Math.min(view.state.doc.content.size, position));
  let tr = view.state.tr;
  if (vim.mode === "visual" || vim.mode === "visual-line") {
    const anchor = vim.visualAnchor ?? view.state.selection.anchor;
    tr = tr.setSelection(TextSelection.create(view.state.doc, anchor, pos));
  } else {
    tr = tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), 1));
  }
  view.dispatch(scroll ? tr.scrollIntoView() : tr);
}

function inlineMotionPosition(
  state: EditorState,
  direction: "left" | "right" | "start" | "end",
  count: number,
): number {
  const { $head } = state.selection;
  if (!$head.parent.isTextblock) return state.selection.head;
  const start = $head.start();
  const end = $head.end();

  if (direction === "start") return start;
  if (direction === "end") return end;
  if (direction === "left") return Math.max(start, state.selection.head - count);
  if (direction === "right") return Math.min(end, state.selection.head + count);

  return Math.max(start, Math.min(end, state.selection.head + (direction === "left" ? -count : count)));
}

function blockRange(state: EditorState, count: number) {
  const blocks = topLevelBlocks(state.doc);
  const startIndex = currentBlockIndex(state);
  const endIndex = Math.min(blocks.length - 1, startIndex + count - 1);
  const from = blocks[startIndex]?.pos ?? 0;
  const endBlock = blocks[endIndex];
  const to = endBlock ? endBlock.pos + endBlock.node.nodeSize : from;
  return { from, to, startIndex };
}

function updateVimState(view: EditorView, meta: VimMeta) {
  view.dispatch(view.state.tr.setMeta(vimModePluginKey, meta));
}

function finishCommand(view: EditorView) {
  updateVimState(view, { count: "", pending: "" });
}

function enterMode(view: EditorView, mode: VimEditorMode, visualAnchor: number | null = null) {
  updateVimState(view, { mode, count: "", pending: "", visualAnchor });
}

function insertParagraphAtBlock(view: EditorView, before: boolean) {
  const blocks = topLevelBlocks(view.state.doc);
  const block = blocks[currentBlockIndex(view.state)];
  if (!block) return;
  const pos = before ? block.pos : block.pos + block.node.nodeSize;
  const paragraph = view.state.schema.nodes.paragraph?.create();
  if (!paragraph) return;
  const tr = view.state.tr.insert(pos, paragraph);
  const selectionPos = Math.min(tr.doc.content.size, pos + 1);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
  view.dispatch(tr.scrollIntoView());
}

function deleteInline(view: EditorView, count: number, registerRef?: { current: VimRegister | null }) {
  const { state } = view;
  const from = state.selection.from;
  const end = state.selection.$from.parent.isTextblock ? state.selection.$from.end() : from;
  if (from >= end) return;
  const to = Math.min(end, from + count);
  if (registerRef) registerRef.current = { slice: state.doc.slice(from, to), linewise: false };
  view.dispatch(state.tr.delete(from, to).scrollIntoView());
}

function setLineVisualSelection(view: EditorView) {
  const lines = visibleNavigation(view.state).lines;
  const line = lines[navigationLineIndex(view.state, view.state.selection.head)];
  if (!line) return;
  const { from, to } = line;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
  enterMode(view, "visual-line", from);
}

function moveByVisualLine(view: EditorView, direction: 1 | -1, count: number, vim: VimPluginState) {
  let position = view.state.selection.head;
  for (let step = 0; step < count; step += 1) {
    const coords = view.coordsAtPos(position);
    const height = Math.max(12, coords.bottom - coords.top);
    let targetPosition = position;
    for (let distance = 1; distance <= 4; distance += 1) {
      const target = view.posAtCoords({
        left: coords.left,
        top: (coords.top + coords.bottom) / 2 + direction * height * distance,
      });
      if (!target || target.pos === position) continue;
      const targetCoords = view.coordsAtPos(target.pos);
      if ((direction > 0 && targetCoords.top > coords.top + 1)
        || (direction < 0 && targetCoords.top < coords.top - 1)) {
        targetPosition = target.pos;
        break;
      }
    }
    if (targetPosition === position) break;
    position = targetPosition;
  }
  dispatchSelection(view, position, vim);
}

function moveByPage(view: EditorView, direction: 1 | -1, vim: VimPluginState, fraction = 1) {
  const root = view.dom.closest<HTMLElement>(".note-editor-scroll");
  if (!root) {
    const current = navigationLineIndex(view.state, view.state.selection.head);
    dispatchSelection(view, positionInNavigationLine(view.state, current + direction * 10, 0), vim);
    return;
  }

  const before = view.coordsAtPos(view.state.selection.head);
  const rootRect = root.getBoundingClientRect();
  const stickyBottom = root.querySelector<HTMLElement>(".note-editor-sticky")
    ?.getBoundingClientRect().bottom ?? rootRect.top;
  const visibleTop = Math.max(rootRect.top, stickyBottom) + 8;
  const visibleBottom = rootRect.bottom - 8;
  const viewportHeight = Math.max(80, visibleBottom - visibleTop);
  const distance = Math.max(40, (viewportHeight - 24) * fraction);
  const targetTop = Math.max(visibleTop, Math.min(visibleBottom, (before.top + before.bottom) / 2));
  const previousScrollTop = root.scrollTop;
  root.scrollTop += direction * distance;
  const moved = root.scrollTop !== previousScrollTop;
  requestAnimationFrame(() => {
    if (!root.isConnected || view.isDestroyed) return;
    const editorRect = view.dom.getBoundingClientRect();
    const left = Math.max(editorRect.left + 8, Math.min(editorRect.right - 8, before.left));
    const target = view.posAtCoords({ left, top: targetTop });
    if (target && target.pos !== view.state.selection.head) {
      dispatchSelection(view, target.pos, vim, false);
      return;
    }
    if (!moved) {
      const current = navigationLineIndex(view.state, view.state.selection.head);
      const lineHeight = Math.max(16, before.bottom - before.top);
      const pageLines = Math.max(1, Math.floor(viewportHeight / lineHeight) - 1);
      dispatchSelection(view, positionInNavigationLine(view.state, current + direction * pageLines, 0), vim);
    }
  });
}

function scrollByVisualLine(view: EditorView, direction: 1 | -1, count: number) {
  const root = view.dom.closest<HTMLElement>(".note-editor-scroll");
  if (!root) return;
  const coords = view.coordsAtPos(view.state.selection.head);
  const computed = getComputedStyle(view.dom);
  const configured = Number.parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(configured)
    ? configured
    : Math.max(16, coords.bottom - coords.top);
  root.scrollTop += direction * lineHeight * count;
}

function isFormattingShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLocaleLowerCase();
  if (!event.shiftKey) return key === "b" || key === "i" || key === "e";
  return key === "x" || key === "b" || key === "7" || key === "8";
}

function handleVimKey(
  view: EditorView,
  event: KeyboardEvent,
  onSearch?: VimModeOptions["onSearch"],
  registerRef?: { current: VimRegister | null },
): boolean {
  const vim = vimModePluginKey.getState(view.state);
  if (!vim?.enabled || event.isComposing || event.keyCode === 229) return false;

  if (vim.mode === "insert") {
    if (event.key !== "Escape") return false;
    enterMode(view, "normal");
    return true;
  }

  const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  const ctrlKey = event.key.toLocaleLowerCase();
  if (ctrlOnly && (ctrlKey === "f" || ctrlKey === "b")) {
    moveByPage(view, ctrlKey === "f" ? 1 : -1, vim);
    finishCommand(view);
    return true;
  }

  if (ctrlOnly && (ctrlKey === "e" || ctrlKey === "y")) {
    scrollByVisualLine(view, ctrlKey === "e" ? 1 : -1, 1);
    finishCommand(view);
    return true;
  }

  if (ctrlOnly && (ctrlKey === "d" || ctrlKey === "u")) {
    moveByPage(view, ctrlKey === "d" ? 1 : -1, vim, 0.5);
    finishCommand(view);
    return true;
  }

  if (ctrlOnly && (ctrlKey === "p" || ctrlKey === "n")) {
    const lines = visibleNavigation(view.state).lines;
    const index = navigationLineIndex(view.state, view.state.selection.head);
    const current = lines[index];
    const preferredOffset = Math.max(0, view.state.selection.head - (current?.from ?? view.state.selection.head));
    dispatchSelection(view, positionInNavigationLine(view.state, index + (ctrlKey === "p" ? -1 : 1), preferredOffset), vim);
    finishCommand(view);
    return true;
  }

  if (ctrlOnly && ctrlKey === "c") {
    if (vim.mode === "visual" || vim.mode === "visual-line") {
      const head = view.state.selection.head;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(head), 1)));
      enterMode(view, "normal");
    } else {
      finishCommand(view);
    }
    return true;
  }

  if (ctrlOnly && ctrlKey === "v") {
    enterMode(view, "visual", view.state.selection.head);
    return true;
  }

  if (event.key === " " || event.code === "Space") {
    const head = view.state.selection.head;
    const section = headingSectionAtPosition(extractHeadingSections(view.state.doc), head);
    if (section && head > section.pos && head < section.headingEnd) {
      toggleHeadingFoldInView(view, section.pos);
    }
    finishCommand(view);
    return true;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    if (!vim.readOnly) redo(view.state, view.dispatch);
    finishCommand(view);
    return true;
  }
  // Normal/Visual 下格式化快捷键不能穿透到 TipTap；其余尚未实现的
  // Ctrl Vim 命令也由 Vim 吞掉，避免 Ctrl+W 关闭标签页、Ctrl+X 剪切等。
  if (isFormattingShortcut(event)) return true;
  if (event.ctrlKey && !event.metaKey && !event.altKey) return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  const key = event.key;
  if (key === "Escape") {
    if (vim.mode === "visual" || vim.mode === "visual-line") {
      const head = view.state.selection.head;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(head), 1)));
      enterMode(view, "normal");
    } else {
      finishCommand(view);
    }
    return true;
  }

  if (/^[1-9]$/.test(key) || (key === "0" && vim.count.length > 0)) {
    updateVimState(view, { count: `${vim.count}${key}` });
    return true;
  }
  const count = Math.max(1, Number.parseInt(vim.count || "1", 10));

  if ((vim.mode === "visual" || vim.mode === "visual-line") && (key === "d" || key === "x" || key === "y")) {
    const selection = view.state.selection;
    if (registerRef) {
      registerRef.current = {
        slice: selection.content(),
        linewise: vim.mode === "visual-line",
      };
    }
    let tr = view.state.tr;
    if (key === "y" || vim.readOnly) {
      tr = tr.setSelection(TextSelection.near(view.state.doc.resolve(selection.head), 1));
    } else {
      tr = tr.deleteSelection();
    }
    tr.setMeta(vimModePluginKey, {
      mode: "normal",
      count: "",
      pending: "",
      visualAnchor: null,
    } satisfies VimMeta);
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  if (vim.pending === "g") {
    if (key === "g") {
      dispatchSelection(view, positionInNavigationLine(view.state, 0, 0), vim);
    } else if (key === "j" || key === "k") {
      moveByVisualLine(view, key === "j" ? 1 : -1, count, vim);
    }
    finishCommand(view);
    return true;
  }

  if (vim.pending === "m" || vim.pending === "'") {
    if (/^[a-z]$/.test(key)) {
      if (vim.pending === "m") setNamedBookmarkInView(view, key);
      else jumpToNamedBookmarkInView(view, key);
    }
    finishCommand(view);
    return true;
  }

  if (vim.pending === "d" || vim.pending === "y") {
    if (key === vim.pending) {
      const { from, to, startIndex } = blockRange(view.state, count);
      if (registerRef) registerRef.current = { slice: view.state.doc.slice(from, to), linewise: true };
      if (vim.pending === "d") {
        if (vim.readOnly) {
          finishCommand(view);
          return true;
        }
        let tr: Transaction;
        if (from === 0 && to === view.state.doc.content.size) {
          const paragraph = view.state.schema.nodes.paragraph.create();
          tr = view.state.tr.replaceWith(from, to, paragraph);
        } else {
          tr = view.state.tr.delete(from, to);
        }
        view.dispatch(tr.scrollIntoView());
        const nextIndex = Math.min(startIndex, view.state.doc.childCount - 1);
        dispatchSelection(view, positionInBlock(view.state, nextIndex, 0), vim);
      }
      finishCommand(view);
      return true;
    }
    finishCommand(view);
    return true;
  }

  const verticalMove = (delta: number) => {
    const lines = visibleNavigation(view.state).lines;
    const index = navigationLineIndex(view.state, view.state.selection.head);
    const current = lines[index];
    const preferredOffset = Math.max(0, view.state.selection.head - (current?.from ?? view.state.selection.head));
    dispatchSelection(view, positionInNavigationLine(view.state, index + delta * count, preferredOffset), vim);
    finishCommand(view);
  };
  const inlineMove = (motion: Parameters<typeof inlineMotionPosition>[1]) => {
    dispatchSelection(view, inlineMotionPosition(view.state, motion, count), vim);
    finishCommand(view);
  };

  switch (key) {
    case "h": inlineMove("left"); return true;
    case "l": inlineMove("right"); return true;
    case "j": verticalMove(1); return true;
    case "k": verticalMove(-1); return true;
    case "w": dispatchSelection(view, wordMotionPosition(view.state, "word-forward", count), vim); finishCommand(view); return true;
    case "b": dispatchSelection(view, wordMotionPosition(view.state, "word-back", count), vim); finishCommand(view); return true;
    case "e": dispatchSelection(view, wordMotionPosition(view.state, "word-end", count), vim); finishCommand(view); return true;
    case "0": inlineMove("start"); return true;
    case "^": inlineMove("start"); return true;
    case "$": inlineMove("end"); return true;
    case "g": updateVimState(view, { pending: "g" }); return true;
    case "m": updateVimState(view, { pending: "m" }); return true;
    case "'": updateVimState(view, { pending: "'" }); return true;
    case "G": {
      const target = vim.count ? count - 1 : visibleNavigation(view.state).lines.length - 1;
      dispatchSelection(view, positionInNavigationLine(view.state, target, 0), vim);
      finishCommand(view);
      return true;
    }
    case "i": if (!vim.readOnly) enterMode(view, "insert"); return true;
    case "a": {
      if (vim.readOnly) return true;
      dispatchSelection(view, inlineMotionPosition(view.state, "right", 1), vim, false);
      enterMode(view, "insert");
      return true;
    }
    case "I": if (!vim.readOnly) { inlineMove("start"); enterMode(view, "insert"); } return true;
    case "A": if (!vim.readOnly) { inlineMove("end"); enterMode(view, "insert"); } return true;
    case "o": if (!vim.readOnly) { insertParagraphAtBlock(view, false); enterMode(view, "insert"); } return true;
    case "O": if (!vim.readOnly) { insertParagraphAtBlock(view, true); enterMode(view, "insert"); } return true;
    case "v": enterMode(view, "visual", view.state.selection.head); return true;
    case "V": setLineVisualSelection(view); return true;
    case "x": if (!vim.readOnly) deleteInline(view, count, registerRef); finishCommand(view); return true;
    case "d": if (!vim.readOnly) updateVimState(view, { pending: "d" }); return true;
    case "y": updateVimState(view, { pending: "y" }); return true;
    case "p": {
      if (vim.readOnly) return true;
      const register = registerRef?.current;
      if (!register) return true;
      if (register.linewise) {
        const block = topLevelBlocks(view.state.doc)[currentBlockIndex(view.state)];
        const pos = block ? block.pos + block.node.nodeSize : view.state.doc.content.size;
        view.dispatch(view.state.tr.replace(pos, pos, register.slice).scrollIntoView());
      } else {
        view.dispatch(view.state.tr.replaceSelection(register.slice).scrollIntoView());
      }
      finishCommand(view);
      return true;
    }
    case "u": if (!vim.readOnly) undo(view.state, view.dispatch); finishCommand(view); return true;
    case "/": onSearch?.(0); finishCommand(view); return true;
    case "n": onSearch?.(1); finishCommand(view); return true;
    case "N": onSearch?.(-1); finishCommand(view); return true;
    default:
      return true;
  }
}

export const VimMode = Extension.create<VimModeOptions>({
  name: "nineRingsVimMode",
  priority: 1000,

  addOptions() {
    return { enabled: false, readOnly: false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const registerRef: { current: VimRegister | null } = { current: null };
    return [
      new Plugin<VimPluginState>({
        key: vimModePluginKey,
        state: {
          init: () => initialState(options.enabled, options.readOnly),
          apply(tr, value) {
            const meta = tr.getMeta(vimModePluginKey) as VimMeta | undefined;
            return meta ? { ...value, ...meta } : value;
          },
        },
        props: {
          handleKeyDown(view, event) {
            return handleVimKey(view, event, options.onSearch, registerRef);
          },
          handleTextInput(view) {
            const vim = vimModePluginKey.getState(view.state);
            return Boolean(vim?.enabled && (vim.readOnly || vim.mode !== "insert"));
          },
          handlePaste(view) {
            const vim = vimModePluginKey.getState(view.state);
            return Boolean(vim?.enabled && (vim.readOnly || vim.mode !== "insert"));
          },
        },
        view(view) {
          let previous: VimEditorMode | null = null;
          let renderFrame: number | null = null;
          const caret = document.createElement("span");
          caret.className = "vim-normal-caret";
          caret.setAttribute("aria-hidden", "true");
          document.body.append(caret);
          const scrollRoot = view.dom.closest<HTMLElement>(".note-editor-scroll");

          const renderCaret = () => {
            renderFrame = null;
            const vim = vimModePluginKey.getState(view.state);
            if (!vim?.enabled || vim.mode !== "normal" || !view.state.selection.empty || !view.hasFocus()) {
              caret.hidden = true;
              return;
            }
            const position = Math.min(view.state.selection.head, view.state.doc.content.size);
            const coords = view.coordsAtPos(position);
            const rootRect = scrollRoot?.getBoundingClientRect();
            const stickyBottom = scrollRoot?.querySelector<HTMLElement>(".note-editor-sticky")
              ?.getBoundingClientRect().bottom ?? rootRect?.top ?? 0;
            if (rootRect && (coords.bottom <= Math.max(rootRect.top, stickyBottom) || coords.top >= rootRect.bottom)) {
              caret.hidden = true;
              return;
            }
            const height = Math.max(2, coords.bottom - coords.top);
            let width = height * 0.56;
            if (position < view.state.doc.content.size) {
              const next = view.coordsAtPos(position + 1);
              if (Math.abs(next.top - coords.top) < 2 && next.left > coords.left) {
                width = Math.min(height, next.left - coords.left);
              }
            }
            caret.style.left = `${coords.left}px`;
            caret.style.top = `${coords.top}px`;
            caret.style.width = `${Math.max(2, width)}px`;
            caret.style.height = `${height}px`;
            caret.style.backgroundColor = getComputedStyle(view.dom).color;
            caret.hidden = false;
          };
          const scheduleCaret = () => {
            if (renderFrame !== null) return;
            renderFrame = requestAnimationFrame(renderCaret);
          };
          const refresh = () => {
            const vim = vimModePluginKey.getState(view.state);
            view.dom.classList.toggle("vim-mode-enabled", Boolean(vim?.enabled));
            view.dom.dataset.vimMode = vim?.enabled ? vim.mode : "off";
            if (vim?.enabled && vim.mode !== previous) options.onModeChange?.(vim.mode);
            previous = vim?.enabled ? vim.mode : null;
            scheduleCaret();
          };
          const viewport = window.visualViewport;
          const handleReadonlyKeyDown = (event: KeyboardEvent) => {
            const vim = vimModePluginKey.getState(view.state);
            if (!vim?.enabled || !vim.readOnly || event.defaultPrevented) return;
            // ProseMirror does not route its editable key handlers when the view
            // is contenteditable=false. Keep a narrow native listener so Vim
            // navigation remains available without making the document writable.
            if (handleVimKey(view, event, options.onSearch, registerRef)) {
              event.preventDefault();
              event.stopPropagation();
            }
          };
          view.dom.addEventListener("focus", scheduleCaret);
          view.dom.addEventListener("blur", scheduleCaret);
          view.dom.addEventListener("keydown", handleReadonlyKeyDown);
          scrollRoot?.addEventListener("scroll", scheduleCaret, { passive: true });
          window.addEventListener("resize", scheduleCaret);
          window.addEventListener("scroll", scheduleCaret, true);
          viewport?.addEventListener("resize", scheduleCaret);
          viewport?.addEventListener("scroll", scheduleCaret);
          refresh();
          return {
            update: refresh,
            destroy() {
              if (renderFrame !== null) cancelAnimationFrame(renderFrame);
              view.dom.removeEventListener("focus", scheduleCaret);
              view.dom.removeEventListener("blur", scheduleCaret);
              view.dom.removeEventListener("keydown", handleReadonlyKeyDown);
              scrollRoot?.removeEventListener("scroll", scheduleCaret);
              window.removeEventListener("resize", scheduleCaret);
              window.removeEventListener("scroll", scheduleCaret, true);
              viewport?.removeEventListener("resize", scheduleCaret);
              viewport?.removeEventListener("scroll", scheduleCaret);
              caret.remove();
              view.dom.classList.remove("vim-mode-enabled");
              delete view.dom.dataset.vimMode;
            },
          };
        },
      }),
    ];
  },
});

export function setVimModeEnabled(editor: Editor, enabled: boolean, readOnly = false) {
  const current = vimModePluginKey.getState(editor.state);
  if (!current || (current.enabled === enabled && current.readOnly === readOnly)) return;
  editor.view.dispatch(editor.state.tr.setMeta(vimModePluginKey, {
    enabled,
    readOnly,
    mode: enabled ? "normal" : "insert",
    count: "",
    pending: "",
    visualAnchor: null,
  } satisfies VimMeta));
}

export function getVimEditorMode(editor: Editor): VimEditorMode | null {
  const state = vimModePluginKey.getState(editor.state);
  return state?.enabled ? state.mode : null;
}
