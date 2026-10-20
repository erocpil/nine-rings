/** Return true only when the pointer is over the visible title text itself. */
export function isPointerOverTitleText(root: HTMLElement, clientX: number): boolean {
  const title = root.querySelector<HTMLElement>(".note-title");
  if (!title) return false;
  const text = title instanceof HTMLInputElement ? title.value : title.textContent ?? "";
  if (!text) return false;

  const style = getComputedStyle(title);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.font = style.font;
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const textWidth = context.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
  const rect = title.getBoundingClientRect();
  const leftInset = Number.parseFloat(style.paddingLeft) || 0;
  const rightInset = Number.parseFloat(style.paddingRight) || 0;
  const availableLeft = rect.left + leftInset;
  const availableRight = rect.right - rightInset;
  const availableWidth = Math.max(0, availableRight - availableLeft);
  let textLeft = availableLeft;
  if (style.textAlign === "center" && textWidth < availableWidth) {
    textLeft += (availableWidth - textWidth) / 2;
  } else if ((style.textAlign === "right" || style.textAlign === "end") && textWidth < availableWidth) {
    textLeft += availableWidth - textWidth;
  }
  if (title instanceof HTMLInputElement) textLeft -= title.scrollLeft;
  const textRight = Math.min(availableRight, textLeft + textWidth);
  return clientX >= Math.max(availableLeft, textLeft) && clientX <= textRight;
}
