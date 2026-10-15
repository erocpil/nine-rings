import type { VocabularyDocumentSummary } from "./plugin-system/builtin-vocabulary";
export interface VocabularyFolder {
  path: string;
  name: string;
  folders: VocabularyFolder[];
  documents: VocabularyDocumentSummary[];
}
/** Input order is retained within each folder; ancestor folders survive global filtering. */
export function vocabularyTree(
  items: readonly VocabularyDocumentSummary[],
  rootPath: string,
  query = "",
): VocabularyFolder {
  const root: VocabularyFolder = {
    path: rootPath,
    name: rootPath,
    folders: [],
    documents: [],
  };
  const folders = new Map([[rootPath, root]]);
  const needle = query.trim().toLocaleLowerCase();
  for (const note of items) {
    const path = note.storagePath ?? "";
    if (path !== rootPath && !path.startsWith(`${rootPath}/`)) continue;
    if (
      needle &&
      !(note.title || "无标题").toLocaleLowerCase().includes(needle)
    )
      continue;
    let parent = root;
    const parts =
      path === rootPath ? [] : path.slice(rootPath.length + 1).split("/");
    for (const name of parts) {
      const key = `${parent.path}/${name}`;
      let folder = folders.get(key);
      if (!folder) {
        folder = { path: key, name, folders: [], documents: [] };
        folders.set(key, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }
    parent.documents.push(note);
  }
  for (const folder of folders.values())
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
  return root;
}
