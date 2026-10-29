import { useCallback, useState } from "react";

/** Common device preferences for source split preview; neither adapter writes
 * content or recreates its source editor when these controls change. */
export function useDocumentPreview() {
  const [preview, updatePreview] = useState(
    () => localStorage.getItem("nr:markdownSplitPreview") === "true",
  );
  const [sync, updateSync] = useState(
    () => localStorage.getItem("nr:markdownPreviewSync") !== "false",
  );
  const setPreview = useCallback((value: boolean) => {
    updatePreview(value);
    localStorage.setItem("nr:markdownSplitPreview", String(value));
  }, []);
  const setSync = useCallback((value: boolean) => {
    updateSync(value);
    localStorage.setItem("nr:markdownPreviewSync", String(value));
  }, []);
  return { preview, setPreview, sync, setSync };
}
