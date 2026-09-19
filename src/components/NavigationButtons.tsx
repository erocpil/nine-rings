import { DOCUMENT_NAVIGATION_EVENT, useNavigationStore } from "../stores/useNavigationStore";
import { isMacPlatform } from "../lib/shortcuts";
import { ToolbarIcon } from "./ToolbarIcon";

export function NavigationButtons() {
  const back = useNavigationStore(state => state.enabled && !state.busy && state.index > 0);
  const forward = useNavigationStore(state => state.enabled && !state.busy && state.index >= 0 && state.index < state.entries.length - 1);
  const modifier = isMacPlatform() ? "⌘⌥" : "Alt+";
  return <span className="document-navigation" role="group" aria-label="位置历史">
    {([-1, 1] as const).map(direction => <button key={direction} type="button" className="focus-btn"
      aria-label={direction < 0 ? "后退" : "前进"} disabled={direction < 0 ? !back : !forward}
      title={`${direction < 0 ? "后退到上一位置" : "前进到下一位置"}（${modifier}${direction < 0 ? "←" : "→"} / 鼠标侧键）`}
      onMouseDown={event => event.preventDefault()}
      onClick={() => window.dispatchEvent(new CustomEvent(DOCUMENT_NAVIGATION_EVENT, { detail: direction }))}
    ><ToolbarIcon name={direction < 0 ? "chevronLeft" : "chevronRight"} /></button>)}
  </span>;
}
