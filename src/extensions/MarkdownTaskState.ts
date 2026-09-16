import { Extension } from "@tiptap/core";

/** Keep Markdown task state on existing list items without replacing list editing commands. */
export const MarkdownTaskState = Extension.create({
  name: "markdownTaskState",
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
