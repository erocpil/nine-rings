import { createContext } from "react";
import type { Note } from "../types/models";
/** Optional database search supplied by the database host, never by disk viewers. */
export const DocumentReferenceSearchContext = createContext<(() => Promise<Note[]>) | null>(null);
