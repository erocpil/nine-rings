import { createContext } from "react";
import type { EditorFoldIconConfig } from "../lib/editor-fold-icons";
/** Shared identity without pulling the optional gutter presenter into app startup. */
export const EditorFoldIconContext =
  createContext<Partial<EditorFoldIconConfig> | null>(null);
