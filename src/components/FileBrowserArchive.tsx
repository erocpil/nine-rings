import { useEffect, useRef, useState } from "react";
import { extractBrowserZipEntry, indexBrowserZip, MAX_ZIP_BYTES, MAX_ZIP_ENTRY_BYTES, zipTextHasControls, type BrowserZipEntry } from "../lib/local-files/browser-zip";
import type { BrowserWorkspaceHost } from "../lib/local-files/browser-workspace-contract";

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const basename = (path: string) => path.split("/").pop() ?? path;

export function FileBrowserArchive({ archive, port }: {
  archive: { rootId: string; node: string }; port: NonNullable<BrowserWorkspaceHost["zipArchive"]>;
}) {
  const [contents, setContents] = useState<{ data: Uint8Array; entries: BrowserZipEntry[] }>();
  const [parent, setParent] = useState("");
  const [selection, setSelection] = useState<{ entry: BrowserZipEntry; bytes: Uint8Array<ArrayBuffer>; preview: string | null }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saveRequest = useRef<AbortController>();
  useEffect(() => {
    const request = new AbortController();
    void port.read(archive.rootId, archive.node, request.signal).then(async blob => {
      if (blob.size > MAX_ZIP_BYTES) throw new Error("ZIP 文件最多 32 MiB");
      const data = new Uint8Array(await blob.arrayBuffer());
      request.signal.throwIfAborted();
      setContents({ data, entries: indexBrowserZip(data) });
    }).catch(cause => { if (!request.signal.aborted) setError(String(cause)); });
    return () => { request.abort(); saveRequest.current?.abort(); };
  }, [archive, port]);
  const go = (path: string) => { setParent(path); setSelection(undefined); setError(""); setMessage(""); };
  const select = (entry: BrowserZipEntry) => {
    if (!contents) return;
    if (entry.directory) { go(entry.path); return; }
    setSelection(undefined); setError(""); setMessage("");
    try {
      const bytes = extractBrowserZipEntry(contents.data, entry);
      let preview: string | null = null;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!zipTextHasControls(text, true)) preview = text;
      } catch { /* Binary files can still be extracted. */ }
      setSelection({ entry, bytes, preview });
    } catch (cause) { setError(String(cause)); }
  };
  const save = async () => {
    if (!selection || saveRequest.current) return;
    const request = new AbortController(); saveRequest.current = request; setSaving(true);
    setError(""); setMessage("");
    try {
      const saved = await port.save(basename(selection.entry.path), selection.bytes);
      if (saved && !request.signal.aborted) setMessage("已提交解压文件");
    } catch (cause) { if (!request.signal.aborted) setError(String(cause)); }
    finally { if (!request.signal.aborted) { setSaving(false); saveRequest.current = undefined; } }
  };
  return <section className="file-browser-zip" aria-label="ZIP 内容">
    <p>{basename(archive.node)} · {parent || "根目录"}</p>
    {error && <p role="alert">{error}</p>}
    {!contents ? !error && <p role="status">正在读取 ZIP 目录…</p> : <>
      {parent && <button type="button" onClick={() => go(parentOf(parent))}>返回上级</button>}
      <ul className="file-browser-plan-items" aria-label="压缩包条目">
        {contents.entries.filter(entry => parentOf(entry.path) === parent).map(entry => <li key={entry.path}>
          <button type="button" aria-pressed={selection?.entry === entry} disabled={!entry.directory && entry.size > MAX_ZIP_ENTRY_BYTES} onClick={() => select(entry)}>
            {entry.directory ? "目录" : "文件"} · {basename(entry.path)}
          </button>
          {!entry.directory && <span>{entry.size} B{entry.size > MAX_ZIP_ENTRY_BYTES ? " · 超过单项解压上限" : ""}</span>}
        </li>)}
      </ul>
      {selection && <section aria-label="条目预览">
        <strong>{selection.entry.path}</strong>
        {selection.preview === null ? <p>无 UTF-8 文本预览。</p> : <pre>{selection.preview.slice(0, 12000) || "空文件"}{selection.preview.length > 12000 ? "\n… 预览已截断" : ""}</pre>}
        <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "解压所选文件"}</button>
      </section>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
