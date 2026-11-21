import { useCallback, useContext } from "react";
import { DocumentImageLibraryContext, DocumentResourceContext } from "../components/DocumentResourceContext";

export function useDocumentExportImages() {
  const allowLibrary = useContext(DocumentImageLibraryContext);
  const resolveResource = useContext(DocumentResourceContext);
  return useCallback(async (source: string) => {
    if (source.startsWith("nr-image://")) {
      if (!allowLibrary) return null;
      const { getImageBlob } = await import("../lib/storage/db-images");
      return getImageBlob(source);
    }
    return await resolveResource?.(source) ?? null;
  }, [allowLibrary, resolveResource]);
}
