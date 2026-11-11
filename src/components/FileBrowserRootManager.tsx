import { useEffect, useRef, useState } from "react";
import type { FileRoot } from "../lib/local-files/file-model";

/** Grant removal never removes a filesystem entry or recursively revokes paths. */
export function FileBrowserRootManager({ roots, displayPath, revoke }: {
  roots: FileRoot[]; displayPath: (id: string, node: string) => Promise<string>; revoke: (id: string) => Promise<void>;
}) {
  const [paths, setPaths] = useState<Record<string, string>>({}), [candidate, setCandidate] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const live = useRef(true), pending = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void Promise.all(roots.map(async root => [root.id, await displayPath(root.id, "").catch(() => root.name)] as const)).then(values => { if (active) setPaths(Object.fromEntries(values)); });
    return () => { active = false; };
  }, [roots, displayPath]);
  const confirm = async () => {
    if (!candidate || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await revoke(candidate); if (live.current) { setCandidate(null); container.current?.closest<HTMLElement>("[role=dialog]")?.focus({ preventScroll: true }); } }
    catch (cause) { if (live.current) setError(`无法撤销授权：${String(cause)}`); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  return <div ref={container} className="file-browser-root-manager">
    <p>仅移除此项授权，不删除磁盘文件。父、子目录各自授权时互不影响：撤销子目录后仍可通过已授权的父目录访问。</p>
    {!roots.length && <p>没有已授权的目录。</p>}
    {roots.map(root => <article key={root.id}><div><strong>{root.name}</strong><p className="file-browser-root-path">{paths[root.id] ?? root.name}</p></div><button type="button" disabled={busy} onClick={() => { setCandidate(root.id); setError(""); }}>撤销授权</button>{candidate === root.id && <div className="file-browser-root-confirm"><p>撤销此目录授权？相关目录标签和历史将移除此授权引用；其它独立授权保留。</p><button type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "正在撤销…" : "确认撤销授权"}</button><button type="button" disabled={busy} onClick={() => setCandidate(null)}>取消</button></div>}</article>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
