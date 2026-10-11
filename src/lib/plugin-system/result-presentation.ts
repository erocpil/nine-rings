/** Host-owned presentation policy, independent of plugin permissions and commands. */
export type DocumentTool = "date" | "statistics" | "image";
export interface ResultPresentation {
  surface: "status" | "popup";
  position: "top" | "center" | "bottom";
}
export const RESULT_PRESENTATION_KEY = "nr:pluginResultPresentation";
const CHANGE = "nr:plugin-result-presentation-change";
export function readResultPresentation(tool: DocumentTool): ResultPresentation {
  const fallback: ResultPresentation = {
    surface: tool === "statistics" ? "popup" : "status",
    position: tool === "statistics" ? "center" : "bottom",
  };
  try {
    const value = JSON.parse(
      localStorage.getItem(RESULT_PRESENTATION_KEY) || "{}",
    )[tool];
    if (
      value &&
      ["status", "popup"].includes(value.surface) &&
      ["top", "center", "bottom"].includes(value.position)
    )
      return { surface: value.surface, position: value.position };
  } catch {
    /* Device-local invalid preferences use safe defaults. */
  }
  return fallback;
}
export function saveResultPresentation(
  tool: DocumentTool,
  value: ResultPresentation,
) {
  if (
    !["status", "popup"].includes(value.surface) ||
    !["top", "center", "bottom"].includes(value.position)
  )
    throw new Error("Invalid presentation");
  const settings = {
    date: readResultPresentation("date"),
    statistics: readResultPresentation("statistics"),
    image: readResultPresentation("image"),
    [tool]: value,
  };
  localStorage.setItem(RESULT_PRESENTATION_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(CHANGE));
}
export function resultPresentationSnapshot() {
  try {
    return localStorage.getItem(RESULT_PRESENTATION_KEY);
  } catch {
    return null;
  }
}
export function subscribeResultPresentation(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === RESULT_PRESENTATION_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}
