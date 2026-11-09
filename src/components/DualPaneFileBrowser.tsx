import { useMemo } from "react";
import type { MainViewRequest } from "../lib/plugin-system/main-view-registry";
import { createNineRingsBrowserHost } from "../lib/local-files/browser-nine-rings-host";
import { FileBrowserWorkspace } from "./FileBrowserWorkspace";

/** The existing plugin entrance composes the same workspace as the standalone app. */
export function DualPaneFileBrowser({ request, active, onClose }: {
  request: Extract<MainViewRequest, { renderer: "file-browser" }>;
  active: boolean; onClose: () => void;
}) {
  const workspace = useMemo(() => createNineRingsBrowserHost(request.owner), [request.owner]);
  return <FileBrowserWorkspace workspace={workspace} active={active} initialRootId={request.data.rootId} onClose={onClose} />;
}
