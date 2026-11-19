/** Portaled toolbar menus retain their context owner without a global active
 * menu singleton. Unrelated editor instances cannot dismiss each other. */
export const CONTEXT_COMMAND_COMPLETE = "nr:context-command-complete";
export function editorContextRoot(trigger: HTMLElement): HTMLElement | null {
  return trigger.closest<HTMLElement>("[data-editor-context-root]");
}
export function editorContextOwner(trigger: HTMLElement): string | undefined {
  return editorContextRoot(trigger)?.dataset.editorContextOwner;
}
export function editorContextContains(root: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (root.contains(target)) return true;
  const owner = (target instanceof Element ? target : target.parentElement)?.closest<HTMLElement>("[data-editor-context-owner]");
  return Boolean(root.dataset.editorContextOwner && owner?.dataset.editorContextOwner === root.dataset.editorContextOwner);
}
export function completeEditorContextCommand(trigger: HTMLElement) {
  editorContextRoot(trigger)?.dispatchEvent(new Event(CONTEXT_COMMAND_COMPLETE));
}
