import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Keep Markdown task state on existing list items without replacing list editing commands. */
export const MarkdownTaskState = Extension.create({
  name: "markdownTaskState",
  addProseMirrorPlugins() {
    const editor = this.editor;
    let document: ProseMirrorNode | null = null;
    let cached = DecorationSet.empty;
    return [
      new Plugin({
        view(view) {
          let editable = view.editable;
          const update = () => {
            view.dom
              .querySelectorAll<HTMLButtonElement>(".markdown-task-checkbox")
              .forEach((button) => {
                button.disabled = !view.editable;
              });
          };
          update();
          return {
            update(next) {
              if (editable !== next.editable) {
                editable = next.editable;
                update();
              }
            },
          };
        },
        props: {
          decorations(state) {
            if (document === state.doc) return cached;
            document = state.doc;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (
                node.type.name !== "listItem" ||
                typeof node.attrs.taskChecked !== "boolean"
              )
                return;
              const checked = node.attrs.taskChecked;
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  (view, getPos) => {
                    const button = window.document.createElement("button");
                    button.type = "button";
                    button.className = "markdown-task-checkbox";
                    button.contentEditable = "false";
                    button.disabled = !view.editable;
                    button.setAttribute("role", "checkbox");
                    button.setAttribute("aria-checked", String(checked));
                    button.setAttribute("aria-label", "任务完成状态");
                    button.textContent = checked ? "☑" : "☐";
                    button.onmousedown = (event) => event.preventDefault();
                    button.onclick = (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (
                        !editor.isEditable ||
                        view.dom.closest(".block-selection-active")
                      )
                        return;
                      const position = getPos();
                      if (position === undefined) return;
                      const current = view.state.doc.nodeAt(position - 1);
                      if (
                        current?.type.name !== "listItem" ||
                        typeof current.attrs.taskChecked !== "boolean"
                      )
                        return;
                      const hadFocus = button === window.document.activeElement;
                      view.dispatch(
                        view.state.tr.setNodeMarkup(position - 1, undefined, {
                          ...current.attrs,
                          taskChecked: !current.attrs.taskChecked,
                        }),
                      );
                      if (hadFocus) {
                        const item = view.nodeDOM(position - 1);
                        if (item instanceof HTMLElement)
                          item
                            .querySelector<HTMLButtonElement>(
                              ":scope > .markdown-task-checkbox",
                            )
                            ?.focus({ preventScroll: true });
                      }
                    };
                    return button;
                  },
                  {
                    side: -1,
                    key: `task-${pos}-${checked}`,
                    stopEvent: () => true,
                  },
                ),
              );
            });
            cached = DecorationSet.create(state.doc, decorations);
            return cached;
          },
        },
      }),
    ];
  },
  addGlobalAttributes() {
    return [
      {
        types: ["listItem"],
        attributes: {
          taskChecked: {
            default: null,
            parseHTML: (element) =>
              element.hasAttribute("data-task-checked")
                ? element.getAttribute("data-task-checked") === "true"
                : null,
            renderHTML: (attributes) =>
              typeof attributes.taskChecked === "boolean"
                ? { "data-task-checked": String(attributes.taskChecked) }
                : {},
          },
        },
      },
    ];
  },
});
