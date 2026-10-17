import { startNumberingAppearance } from "./numbering-display";
import { startBuiltinNumberingDisplay } from "./builtin-numbering-display";
import { startBuiltinStatusDisplay } from "./builtin-status-display";
export function startEditorPresentationService() {
  const stopAppearance = startNumberingAppearance();
  const stopBuiltin = startBuiltinNumberingDisplay();
  const stopStatus = startBuiltinStatusDisplay();
  return () => {
    stopStatus();
    stopBuiltin();
    stopAppearance();
  };
}
