import { treeDisplay } from "./builtin-tree-display";
import { outlineDisplay } from "./builtin-outline-display";
import { bookmarkDisplay } from "./builtin-bookmark-display";
import { notesDisplay } from "./builtin-notes-display";
import { sourceSymbolDisplay } from "./builtin-source-symbol-display";
import { sourceMatchDisplay } from "./builtin-source-match-display";
import { localFileDisplay } from "./builtin-local-file-display";
const presenters = {
  "tree-display": treeDisplay,
  "outline-display": outlineDisplay,
  "bookmark-display": bookmarkDisplay,
  "notes-display": notesDisplay,
  "source-symbol-display": sourceSymbolDisplay,
  "source-match-display": sourceMatchDisplay,
  "local-file-display": localFileDisplay,
};
export function panelPresenter(configuration: string) {
  return Object.prototype.hasOwnProperty.call(presenters, configuration)
    ? presenters[configuration as keyof typeof presenters]
    : null;
}
