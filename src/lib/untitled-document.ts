/** Match quick creation and empty-title saves without reusing another sibling's name. */
export function untitledDocumentName(
  documents: readonly { id: string; title: string | null; storagePath?: string }[],
  path: string,
  excludeId?: string,
  preferred?: string | null,
): string {
  const names = new Set(documents.filter(note => note.id !== excludeId && (note.storagePath ?? "") === path).map(note => note.title?.trim()));
  if (preferred && /^未命名(?: [2-9]\d*| 1\d+)?$/.test(preferred) && !names.has(preferred)) return preferred;
  let name = "未命名";
  for (let index = 2; names.has(name); index++) name = `未命名 ${index}`;
  return name;
}
