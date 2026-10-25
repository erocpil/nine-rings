/** True for a visible line number or fold marker, excluding empty gutter space. */
export function isSourceGutterControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const lineNumber = target.closest(".cm-lineNumbers .cm-gutterElement");
  if (lineNumber?.textContent?.trim()) return true;
  const foldMarker = target.closest(".cm-foldGutter .cm-gutterElement");
  return Boolean(foldMarker && (foldMarker.textContent?.trim() || foldMarker.childElementCount > 0));
}
