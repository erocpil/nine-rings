import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface CjkLatinSpacingState {
  enabled: boolean;
  decorations: DecorationSet;
}

interface TextUnit {
  char: string;
  from: number;
  to: number;
  excluded: boolean;
}

const pluginKey = new PluginKey<CjkLatinSpacingState>("cjkLatinSpacing");
const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_OR_NUMBER = /[\p{Script=Latin}\p{Number}]/u;

export function needsCjkLatinSpacing(left: string, right: string): boolean {
  return (HAN_CHARACTER.test(left) && LATIN_OR_NUMBER.test(right))
    || (LATIN_OR_NUMBER.test(left) && HAN_CHARACTER.test(right));
}

export function supportsNativeCjkLatinSpacing(): boolean {
  return typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && CSS.supports("text-autospace", "normal");
}

function textUnits(node: ProseMirrorNode, nodePosition: number): TextUnit[] {
  const units: TextUnit[] = [];
  node.descendants((child, relativePosition) => {
    if (!child.isText || !child.text) {
      if (child.isInline) {
        const position = nodePosition + 1 + relativePosition;
        units.push({ char: " ", from: position, to: position + child.nodeSize, excluded: true });
      }
      return;
    }

    const excluded = child.marks.some((mark) => mark.type.name === "code");
    let offset = 0;
    for (const char of child.text) {
      const from = nodePosition + 1 + relativePosition + offset;
      units.push({ char, from, to: from + char.length, excluded });
      offset += char.length;
    }
  });
  return units;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const boundaryClasses = new Map<string, { from: number; to: number; classes: Set<string> }>();

  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") return false;

    const units = textUnits(node, position);
    for (let index = 0; index < units.length - 1; index++) {
      const left = units[index];
      const right = units[index + 1];
      if (left.excluded || right.excluded || !needsCjkLatinSpacing(left.char, right.char)) continue;

      const target = HAN_CHARACTER.test(left.char) ? right : left;
      const className = HAN_CHARACTER.test(left.char)
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
              return { enabled, decorations: buildDecorations(nextState.doc) };
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
