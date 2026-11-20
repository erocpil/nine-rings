/** Preserve the document's address, including relative paths and fragments. */
export function documentLinkAtTarget(
  target: EventTarget | null,
  body: HTMLElement | null,
): string | undefined {
  if (!(target instanceof Element) || !body) return;
  const anchor = target.closest("a[href]");
  if (
    !anchor ||
    !body.contains(anchor) ||
    anchor.closest(
      "button, [data-footnote-reference], .nr-footnote-reference, .nr-footnote-backref",
    )
  )
    return;
  return anchor.getAttribute("href") || undefined;
}
