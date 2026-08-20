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
 * 文档优先保证可立即打开，不启用纯视觉性质的兜底间距。
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

export function supportsNativeCjkLatinSpacing(): boolean {
  return typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && CSS.supports("text-autospace", "normal");
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const boundaryClasses = new Map<string, { from: number; to: number; classes: Set<string> }>();

  doc.descendants((node, position) => {
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

      let offset = 0;
      for (const char of child.text) {
        const from = position + 1 + relativePosition + offset;
        const current = { char, from, to: from + char.length };
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
      }),
    ];
  },
});

export function setCjkLatinSpacing(editor: Editor, enabled: boolean): void {
  const current = pluginKey.getState(editor.state);
  if (current?.enabled === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(pluginKey, enabled));
}
