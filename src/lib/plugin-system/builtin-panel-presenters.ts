import { treeDisplay } from "./builtin-tree-display";
import { outlineDisplay } from "./builtin-outline-display";
import { bookmarkDisplay } from "./builtin-bookmark-display";
import { notesDisplay } from "./builtin-notes-display";
const presenters = {
  "tree-display": treeDisplay,
  "outline-display": outlineDisplay,
  "bookmark-display": bookmarkDisplay,
  "notes-display": notesDisplay,
};
export function panelPresenter(configuration: string) {
  return Object.prototype.hasOwnProperty.call(presenters, configuration)
    ? presenters[configuration as keyof typeof presenters]
    : null;
}
