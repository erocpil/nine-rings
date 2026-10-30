/** Sidebar dismissal must yield while a visible source workspace uses Vim,
 * even when focus is still on the sidebar button that opened it. Foreground
 * dialogs and menus keep their own Escape handling. */
export function sourceVimOwnsEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false;
  return [...document.querySelectorAll<HTMLElement>('.markdown-cm-source[data-source-vim="true"]')]
    .some(element => element.getClientRects().length > 0 && !element.closest('[inert], [hidden]'));
}
