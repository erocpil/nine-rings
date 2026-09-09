const KEY = "nr:codeBlockHeightPercent";
const EVENT = "nine-rings:block-display-change";
export function codeBlockHeightPercent() {
  const value = Number(localStorage.getItem(KEY));
  return [40, 60, 80, 100].includes(value) ? value : 60;
}
function apply() {
  document.documentElement.style.setProperty("--code-block-height", `calc(var(--app-viewport-height, 100dvh) * ${codeBlockHeightPercent() / 100})`);
}
export function setCodeBlockHeightPercent(value: number) {
  if (![40, 60, 80, 100].includes(value)) return;
  localStorage.setItem(KEY, String(value));
  apply();
  window.dispatchEvent(new Event(EVENT));
}
export function watchBlockDisplaySettings() {
  apply();
  window.addEventListener("storage", apply);
  return () => window.removeEventListener("storage", apply);
}
