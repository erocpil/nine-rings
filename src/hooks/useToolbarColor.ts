import { useEffect, useState } from "react";
/** Device-local last action, deliberately independent of the caret's marks. */
export function useToolbarColor(kind: "text" | "background", fallback: string) {
  const key = `nr:toolbar-last-${kind}-color`;
  const [color, setColor] = useState(() => {
    try { const value = localStorage.getItem(key); return value && /^#[\da-f]{6}$/i.test(value) ? value : fallback; }
    catch { return fallback; }
  });
  useEffect(() => {
    const refresh = () => {
      try { const value = localStorage.getItem(key); if (value && /^#[\da-f]{6}$/i.test(value)) setColor(value); } catch { /* optional storage */ }
    };
    window.addEventListener("nr:toolbar-color", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("nr:toolbar-color", refresh); window.removeEventListener("storage", refresh); };
  }, [key]);
  return [color, (value: string) => {
    setColor(value);
    try { localStorage.setItem(key, value); window.dispatchEvent(new Event("nr:toolbar-color")); } catch { /* unavailable storage keeps session state */ }
  }] as const;
}
