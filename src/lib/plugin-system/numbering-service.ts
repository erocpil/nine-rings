import { startNumberingAppearance } from "./numbering-display";
import { startBuiltinNumberingDisplay } from "./builtin-numbering-display";
export function startNumberingService() {
  const stopAppearance = startNumberingAppearance();
  const stopBuiltin = startBuiltinNumberingDisplay();
  return () => {
    stopBuiltin();
    stopAppearance();
  };
}
