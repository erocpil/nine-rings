/** True for a visible line number or any position in the fold-control column. */
export function isSourceGutterControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const lineNumber = target.closest(".cm-lineNumbers .cm-gutterElement");
  if (lineNumber?.textContent?.trim()) return true;
  return Boolean(target.closest(".cm-foldGutter"));
}
