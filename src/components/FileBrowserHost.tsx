import type { BrowserDragSource } from "../lib/local-files/browser-drag";
import { createContext, useContext } from "react";
import type { BrowserWorkspaceHost } from "../lib/local-files/browser-workspace-contract";

export const FileBrowserHostContext = createContext<BrowserWorkspaceHost | null>(null);
export function useFileBrowserHost() {
  const host = useContext(FileBrowserHostContext);
  if (!host) throw new Error("文件浏览界面缺少应用宿主");
  return host;
}

/** Only the originating workspace can validate/take its live in-memory drag. */
export const FileBrowserDragContext = createContext<{ current(): BrowserDragSource | null; take(token: string): BrowserDragSource | null } | null>(null);
