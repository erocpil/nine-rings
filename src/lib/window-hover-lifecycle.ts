/** A hover hint belongs to the current foreground interaction, not the next
 * activation of the application. Never reopen it automatically on focus. */
export function watchWindowHoverDismiss(dismiss: () => void): () => void {
  const visibility = () => { if (document.visibilityState === "hidden") dismiss(); };
  window.addEventListener("blur", dismiss);
  window.addEventListener("pagehide", dismiss);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("blur", dismiss);
    window.removeEventListener("pagehide", dismiss);
    document.removeEventListener("visibilitychange", visibility);
  };
}
