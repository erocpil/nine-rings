import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface CjkLatinSpacingState {
  enabled: boolean;
  decorations: DecorationSet;
}

const pluginKey = new PluginKey<CjkLatinSpacingState>("cjkLatinSpacing");
const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_OR_NUMBER = /[\p{Script=Latin}\p{Number}]/u;

/**
 * WebView2 不支持原生 text-autospace 时会用 ProseMirror decoration 兜底。
 * 超大文档若为每个中西文边界创建 decoration，会长时间占满启动主线程；这类
 * 文档仅为可视区附近创建 decoration，滚动时按需更新。
 */
export const MAX_CJK_FALLBACK_DOCUMENT_SIZE = 100_000;

export function shouldApplyCjkSpacingFallback(documentSize: number): boolean {
  return Number.isFinite(documentSize)
    && documentSize >= 0
    && documentSize <= MAX_CJK_FALLBACK_DOCUMENT_SIZE;
}

export function needsCjkLatinSpacing(left: string, right: string): boolean {
  return (HAN_CHARACTER.test(left) && LATIN_OR_NUMBER.test(right))
    || (LATIN_OR_NUMBER.test(left) && HAN_CHARACTER.test(right));
}

let measuredNativeSpacing: boolean | undefined;
export function supportsNativeCjkLatinSpacing(): boolean {
  if (typeof CSS === "undefined" || typeof document === "undefined"
    || !document.body || !CSS.supports("text-autospace", "normal")) return false;
  if (measuredNativeSpacing !== undefined) return measuredNativeSpacing;
  // Older WebViews may parse the property without implementing its layout.
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;visibility:hidden;white-space:nowrap;font:32px sans-serif;letter-spacing:0";
  probe.textContent = "中A文3中";
  document.body.append(probe);
  try {
    probe.style.setProperty("text-autospace", "no-autospace");
    const without = probe.getBoundingClientRect().width;
    probe.style.setProperty("text-autospace", "normal");
    measuredNativeSpacing = probe.getBoundingClientRect().width > without + 1;
    return measuredNativeSpacing;
  } finally {
    probe.remove();
  }
}

function buildDecorations(doc: ProseMirrorNode, from = 0, to = doc.content.size): DecorationSet {
  const boundaryClasses = new Map<string, { from: number; to: number; classes: Set<string> }>();

  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") return false;

    // 流式扫描文本，不再为文档中的每个字符分配 TextUnit 对象。GitHub 备份
    // 恢复出的长文档通常包含几十万字符，旧实现会在首次打开时制造大量短命对象。
    let previous: { char: string; from: number; to: number } | null = null;
    node.descendants((child, relativePosition) => {
      if (!child.isText || !child.text) {
        if (child.isInline) previous = null;
        return;
      }
      if (child.marks.some((mark) => mark.type.name === "code")) {
        previous = null;
        return;
      }

      const base = position + 1 + relativePosition;
      let offset = Math.max(0, from - base);
      const text = child.text.slice(offset, Math.max(0, to - base));
      for (const char of text) {
        const at = base + offset;
        const current = { char, from: at, to: at + char.length };
        if (previous && needsCjkLatinSpacing(previous.char, current.char)) {
          const leftIsHan = HAN_CHARACTER.test(previous.char);
          const target = leftIsHan ? current : previous;
          const className = leftIsHan
            ? "cjk-auto-space-before"
            : "cjk-auto-space-after";
          const key = `${target.from}:${target.to}`;
          const boundary = boundaryClasses.get(key) ?? {
            from: target.from,
            to: target.to,
            classes: new Set<string>(),
          };
          boundary.classes.add(className);
          boundaryClasses.set(key, boundary);
        }
        previous = current;
        offset += char.length;
      }
    });
    return false;
  });

  return DecorationSet.create(doc, [...boundaryClasses.values()].map((boundary) =>
    Decoration.inline(boundary.from, boundary.to, {
      class: [...boundary.classes].join(" "),
      "data-cjk-auto-space": "true",
    }),
  ));
}

export const CjkLatinSpacing = Extension.create({
  name: "cjkLatinSpacing",

  addProseMirrorPlugins() {
    return [
      new Plugin<CjkLatinSpacingState>({
        key: pluginKey,
        state: {
          init: () => ({ enabled: false, decorations: DecorationSet.empty }),
          apply(transaction, previous, _oldState, nextState) {
            const requested = transaction.getMeta(pluginKey);
            const enabled = typeof requested === "boolean" ? requested : previous.enabled;
            if (!enabled) return { enabled, decorations: DecorationSet.empty };
            if (requested && typeof requested === "object") {
              return { enabled, decorations: buildDecorations(nextState.doc, requested.from, requested.to) };
            }
            if (transaction.docChanged || enabled !== previous.enabled) {
              const decorations = shouldApplyCjkSpacingFallback(nextState.doc.content.size)
                ? buildDecorations(nextState.doc)
                : DecorationSet.empty;
              return { enabled, decorations };
            }
            return { enabled, decorations: previous.decorations.map(transaction.mapping, transaction.doc) };
          },
        },
        props: {
          decorations: (state) => pluginKey.getState(state)?.decorations ?? null,
        },
        view(view) {
          let frame = 0;
          let lastDoc: ProseMirrorNode | undefined;
          let range = { from: -1, to: -1 };
          const refresh = () => {
            frame = 0;
            if (view.isDestroyed || !pluginKey.getState(view.state)?.enabled
              || shouldApplyCjkSpacingFallback(view.state.doc.content.size)) {
              lastDoc = undefined;
              return;
            }
            const rect = view.dom.getBoundingClientRect();
            const scroller = view.dom.closest(".note-editor-scroll")?.getBoundingClientRect();
            const top = Math.max(0, rect.top, scroller?.top ?? 0);
            const bottom = Math.min(window.innerHeight, rect.bottom, scroller?.bottom ?? window.innerHeight);
            if (bottom <= top || !rect.width) return;
            const left = Math.max(1, rect.left + Math.min(40, rect.width / 2));
            const first = view.posAtCoords({ left, top: top + 1 })?.pos ?? view.state.selection.from;
            const last = view.posAtCoords({ left, top: bottom - 1 })?.pos ?? first;
            if (lastDoc === view.state.doc && first >= range.from + 1000 && last <= range.to - 1000) return;
            const from = Math.max(0, first - 4000);
            const to = Math.min(view.state.doc.content.size, Math.max(first, last) + 4000);
            if (lastDoc === view.state.doc && from === range.from && to === range.to) return;
            range = { from, to };
            lastDoc = view.state.doc;
            view.dispatch(view.state.tr.setMeta(pluginKey, range));
          };
          const schedule = () => {
            if (!pluginKey.getState(view.state)?.enabled || shouldApplyCjkSpacingFallback(view.state.doc.content.size)) {
              lastDoc = undefined;
              return;
            }
            if (!frame) frame = requestAnimationFrame(refresh);
          };
          view.dom.ownerDocument.addEventListener("scroll", schedule, true);
          window.addEventListener("resize", schedule);
          schedule();
          return {
            update: schedule,
            destroy() {
              cancelAnimationFrame(frame);
              view.dom.ownerDocument.removeEventListener("scroll", schedule, true);
              window.removeEventListener("resize", schedule);
            },
          };
        },
      }),
    ];
  },
});

export function setCjkLatinSpacing(editor: Editor, enabled: boolean): void {
  const current = pluginKey.getState(editor.state);
  if (current?.enabled === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(pluginKey, enabled));
}
