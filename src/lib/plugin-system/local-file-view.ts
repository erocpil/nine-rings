import { mainViews, type LocalFileViewData } from "./main-view-registry";
import { workspacePanels } from "./panel-registry";
import { LOCAL_FILE_VIEW_ID } from "./builtin-local-files";
import { FILE_BROWSER_FILE_VIEW_ID } from "./builtin-file-browser";

/** Continue the current editor's owner; otherwise prefer the file-tree plugin. */
export function openLocalFileView(data: LocalFileViewData) {
  const current = mainViews.getSnapshot().current;
  if (current?.renderer === "local-file") return mainViews.bind(current.owner).open(current.view.id, data);
  const files = workspacePanels.getSnapshot().some(panel => panel.id === "files");
  return mainViews.bind(workspacePanels.assert(files ? "files" : "browser")).open(files ? LOCAL_FILE_VIEW_ID : FILE_BROWSER_FILE_VIEW_ID, data);
}
