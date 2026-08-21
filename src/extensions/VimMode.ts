import { Extension, type Editor } from "@tiptap/core";
import { redo, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export type VimEditorMode = "normal" | "insert" | "visual" | "visual-line";

interface VimPluginState {
  enabled: boolean;
  mode: VimEditorMode;
  count: string;
  pending: "" | "d" | "y" | "g";
  visualAnchor: number | null;
}

type VimMeta = Partial<VimPluginState>;

interface VimRegister {
  slice: Slice;
  linewise: boolean;
}

export interface VimModeOptions {
  enabled: boolean;
  onModeChange?: (mode: VimEditorMode) => void;
  onSearch?: (direction: 1 | -1 | 0) => void;
}

export const vimModePluginKey = new PluginKey<VimPluginState>("nineRingsVimMode");

const initialState = (enabled: boolean): VimPluginState => ({
  enabled,
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
  direction: "left" | "right" | "start" | "end" | "word-forward" | "word-back" | "word-end",
  count: number,
): number {
  const { $head } = state.selection;
  if (!$head.parent.isTextblock) return state.selection.head;
  const start = $head.start();
  const end = $head.end();
  const offset = $head.parentOffset;
  const text = $head.parent.textBetween(0, $head.parent.content.size, "\n", "\ufffc");

  if (direction === "start") return start;
  if (direction === "end") return end;
  if (direction === "left") return Math.max(start, state.selection.head - count);
  if (direction === "right") return Math.min(end, state.selection.head + count);

  let next = Math.max(0, Math.min(text.length, offset));
  for (let step = 0; step < count; step += 1) {
    if (direction === "word-forward") {
      const remainder = text.slice(Math.min(text.length, next + (step === 0 ? 0 : 1)));
      const match = remainder.match(/(?:[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_])\s*/u);
      next = match ? Math.min(text.length, next + match.index! + match[0].length) : text.length;
      while (next < text.length && /\s/u.test(text[next])) next += 1;
    } else if (direction === "word-back") {
      let cursor = Math.max(0, next - 1);
      while (cursor > 0 && /\s/u.test(text[cursor])) cursor -= 1;
      const word = /[\p{L}\p{N}_]/u.test(text[cursor] ?? "");
      while (cursor > 0 && (/[\p{L}\p{N}_]/u.test(text[cursor - 1]) === word) && !/\s/u.test(text[cursor - 1])) cursor -= 1;
      next = cursor;
    } else {
      let cursor = Math.min(text.length - 1, next + 1);
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
      const word = /[\p{L}\p{N}_]/u.test(text[cursor] ?? "");
      while (cursor + 1 < text.length && (/[\p{L}\p{N}_]/u.test(text[cursor + 1]) === word) && !/\s/u.test(text[cursor + 1])) cursor += 1;
      next = Math.min(text.length, cursor);
    }
  }
  return Math.max(start, Math.min(end, start + next));
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
  const block = topLevelBlocks(view.state.doc)[currentBlockIndex(view.state)];
  if (!block) return;
  const from = firstTextPosition(block.node, block.pos);
  const to = lastTextPosition(block.node, block.pos);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
  enterMode(view, "visual-line", from);
}

function moveByPage(view: EditorView, direction: 1 | -1, vim: VimPluginState) {
  const root = view.dom.closest<HTMLElement>(".note-editor-scroll");
  if (!root) {
    const targetIndex = currentBlockIndex(view.state) + direction * 10;
    dispatchSelection(view, positionInBlock(view.state, targetIndex, 0), vim);
    return;
  }

  const before = view.coordsAtPos(view.state.selection.head);
  const distance = Math.max(80, root.clientHeight * 0.8);
  root.scrollTop += direction * distance;
  requestAnimationFrame(() => {
    if (!root.isConnected || view.isDestroyed) return;
    const rect = root.getBoundingClientRect();
    const editorRect = view.dom.getBoundingClientRect();
    const left = Math.max(editorRect.left + 8, Math.min(editorRect.right - 8, before.left));
    const top = direction > 0
      ? Math.max(rect.top + 24, rect.bottom - 32)
      : Math.min(rect.bottom - 24, rect.top + 32);
    const target = view.posAtCoords({ left, top });
    if (target) dispatchSelection(view, target.pos, vim, false);
  });
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

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    redo(view.state, view.dispatch);
    finishCommand(view);
    return true;
  }
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
    if (key === "y") {
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
    if (key === "g") dispatchSelection(view, positionInBlock(view.state, 0, 0), vim);
    finishCommand(view);
    return true;
  }

  if (vim.pending === "d" || vim.pending === "y") {
    if (key === vim.pending) {
      const { from, to, startIndex } = blockRange(view.state, count);
      if (registerRef) registerRef.current = { slice: view.state.doc.slice(from, to), linewise: true };
      if (vim.pending === "d") {
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
    const index = currentBlockIndex(view.state);
    const blocks = topLevelBlocks(view.state.doc);
    const current = blocks[index];
    const currentStart = current ? firstTextPosition(current.node, current.pos) : view.state.selection.head;
    const preferredOffset = Math.max(0, view.state.selection.head - currentStart);
    dispatchSelection(view, positionInBlock(view.state, index + delta * count, preferredOffset), vim);
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
    case "w": inlineMove("word-forward"); return true;
    case "b": inlineMove("word-back"); return true;
    case "e": inlineMove("word-end"); return true;
    case "0": inlineMove("start"); return true;
    case "^": inlineMove("start"); return true;
    case "$": inlineMove("end"); return true;
    case "g": updateVimState(view, { pending: "g" }); return true;
    case "G": {
      const target = vim.count ? count - 1 : view.state.doc.childCount - 1;
      dispatchSelection(view, positionInBlock(view.state, target, 0), vim);
      finishCommand(view);
      return true;
    }
    case "i": enterMode(view, "insert"); return true;
    case "a": {
      dispatchSelection(view, inlineMotionPosition(view.state, "right", 1), vim, false);
      enterMode(view, "insert");
      return true;
    }
    case "I": inlineMove("start"); enterMode(view, "insert"); return true;
    case "A": inlineMove("end"); enterMode(view, "insert"); return true;
    case "o": insertParagraphAtBlock(view, false); enterMode(view, "insert"); return true;
    case "O": insertParagraphAtBlock(view, true); enterMode(view, "insert"); return true;
    case "v": enterMode(view, "visual", view.state.selection.head); return true;
    case "V": setLineVisualSelection(view); return true;
    case "x": deleteInline(view, count, registerRef); finishCommand(view); return true;
    case "d": updateVimState(view, { pending: "d" }); return true;
    case "y": updateVimState(view, { pending: "y" }); return true;
    case "p": {
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
    case "u": undo(view.state, view.dispatch); finishCommand(view); return true;
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
    return { enabled: false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const registerRef: { current: VimRegister | null } = { current: null };
    return [
      new Plugin<VimPluginState>({
        key: vimModePluginKey,
        state: {
          init: () => initialState(options.enabled),
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
            return Boolean(vim?.enabled && vim.mode !== "insert");
          },
          handlePaste(view) {
            const vim = vimModePluginKey.getState(view.state);
            return Boolean(vim?.enabled && vim.mode !== "insert");
          },
          decorations(state) {
            const vim = vimModePluginKey.getState(state);
            if (!vim?.enabled || vim.mode !== "normal" || !state.selection.empty) return null;
            const pos = Math.min(state.selection.head, state.doc.content.size);
            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, () => {
                const caret = document.createElement("span");
                caret.className = "vim-normal-caret";
                caret.setAttribute("aria-hidden", "true");
                return caret;
              }, { side: 1 }),
            ]);
          },
        },
        view(view) {
          let previous: VimEditorMode | null = null;
          const refresh = () => {
            const vim = vimModePluginKey.getState(view.state);
            view.dom.classList.toggle("vim-mode-enabled", Boolean(vim?.enabled));
            view.dom.dataset.vimMode = vim?.enabled ? vim.mode : "off";
            if (vim?.enabled && vim.mode !== previous) options.onModeChange?.(vim.mode);
            previous = vim?.enabled ? vim.mode : null;
          };
          refresh();
          return {
            update: refresh,
            destroy() {
              view.dom.classList.remove("vim-mode-enabled");
              delete view.dom.dataset.vimMode;
            },
          };
        },
      }),
    ];
  },
});

export function setVimModeEnabled(editor: Editor, enabled: boolean) {
  const current = vimModePluginKey.getState(editor.state);
  if (!current || current.enabled === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(vimModePluginKey, {
    enabled,
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
