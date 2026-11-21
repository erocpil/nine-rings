import { previewBrowserRename, type BrowserRenameRules } from "../local-files/browser-rename";

self.onmessage = ({ data }: MessageEvent<{ nodes: readonly string[]; rules: BrowserRenameRules }>) => {
  try { self.postMessage({ rows: previewBrowserRename(data.nodes, data.rules) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
