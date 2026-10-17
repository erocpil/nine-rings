import { normalizeEditorColor } from "./editor-color";
import { blockWorkspacePreferences, BLOCK_WORKSPACE_DISPLAY_EVENT } from "./block-display-settings";
import { QUOTE_ALERTS, quoteAlertPalette } from "./quote-alert-colors";

/** Observe theme tokens once per window, not once per quote or retained document. */
export function startQuoteAlertAppearance() {
  const root = document.documentElement;
  let stopped = false, frame: number | null = null;
  const sample = document.createElement("span");
  sample.setAttribute("aria-hidden", "true");
  sample.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  const readColor = (name: string) => {
    sample.style.color = `var(${name})`;
    return normalizeEditorColor(getComputedStyle(sample).color);
  };
  const apply = () => {
    if (stopped) return;
    frame = null;
    const requested = blockWorkspacePreferences().quoteAlertColors ?? "semantic";
    let palette: ReturnType<typeof quoteAlertPalette> = null;
    if (requested === "semantic") {
      document.body.append(sample);
      try {
        const bg = readColor("--bg"), surface = readColor("--surface"), text = readColor("--text");
        if (bg && surface && text) palette = quoteAlertPalette([bg, surface], text);
      } finally { sample.remove(); }
    }
    const effective = palette ? "semantic" : "style";
    if (root.dataset.quoteAlertColors !== effective) root.dataset.quoteAlertColors = effective;
    for (const kind of Object.keys(QUOTE_ALERTS)) {
      const property = `--quote-alert-${kind.toLowerCase()}`;
      const value = palette?.[kind as keyof typeof QUOTE_ALERTS] ?? "var(--accent)";
      if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value);
    }
  };
  const schedule = () => { if (!stopped && frame === null) frame = requestAnimationFrame(apply); };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-interface-style", "data-interface-color-mode", "data-plugin-theme"] });
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, schedule);
  window.addEventListener("storage", schedule);
  apply();
  return () => {
    stopped = true;
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, schedule);
    window.removeEventListener("storage", schedule);
    sample.remove();
  };
}
