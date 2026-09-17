import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { withTimeout } from "../lib/async";
import { DocumentPathPicker } from "./DocumentPathPicker";

export function ImportPathPicker({ anchor, initialPath, onSelect, onClose }: {
  anchor: HTMLElement | null;
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void withTimeout(api.docs.tree(false), 15000, "加载文档目录").then(nodes => {
      if (active) {
        setPaths(nodes.filter(node => node.type === "folder").map(node => node.path));
        setProtectedPaths(nodes.filter(node => node.type === "folder" && node.protected).map(node => node.path));
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  return <DocumentPathPicker inline anchor={anchor} paths={paths} protectedPaths={protectedPaths} initialPath={initialPath}
    selectDestination loading={loading} error={error} onRetry={() => setReload(value => value + 1)}
    onSelect={onSelect} onClose={onClose} />;
}
