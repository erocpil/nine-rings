import { useEffect, useRef, useState } from "react";
import { compareBrowserDirectories, type BrowserDirectory, type ComparedBrowserEntry } from "../lib/local-files/browser-tools";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import type { FileNode } from "../lib/local-files/service";
const labels = { left: "仅左侧", right: "仅右侧", type: "类型不同", different: "元信息不同", metadata: "元信息一致", directory: "目录 · 见内部条目/深度限制", unknown: "未核验 · 未知", content: "正文相同（SHA-256）", "content-different": "正文不同（SHA-256）" };
export function FileBrowserComparison({ directories, names, provider, onOpen }: { directories: [BrowserDirectory, BrowserDirectory]; names: [string, string]; provider: ReturnType<typeof localDirectoryProvider>; onOpen: (side: 0 | 1, node: FileNode) => void }) {
  const [rows, setRows] = useState<ComparedBrowserEntry[]>([]), [progress, setProgress] = useState("正在枚举目录…"), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [depth, setDepth] = useState(0), [content, setContent] = useState(false);
  const [binary, setBinary] = useState(false);
  const [run, setRun] = useState({ depth: 0, content: false, binary: false, revision: 0 });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const operation = new AbortController(); controller.current = operation;
    setRows([]); setPage(0); setBusy(true); setError(""); setProgress("正在枚举目录…");
    void compareBrowserDirectories(provider, directories, operation.signal, message => { if (!operation.signal.aborted) setProgress(message); }, run).then(result => { if (!operation.signal.aborted) { setRows(result); setProgress(`完成，共 ${result.length} 项`); } }).catch(reason => { if (!operation.signal.aborted) { setError(String(reason)); setProgress("比较未完成，未生成完整结果。"); } }).finally(() => { if (!operation.signal.aborted) setBusy(false); });
    return () => operation.abort();
  }, [directories, provider, run]);
  const filtered = rows.filter(row => row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 200) - 1), currentPage = Math.min(page, lastPage);
  return <section aria-label="目录比较结果"><p>{names[0]} ↔ {names[1]}</p><p>默认仅比较当前层级元信息（含隐藏项）。“元信息一致”不代表内容相同。可明确选择递归层数和正文核验；目录本身不判为相同，也不是磁盘快照。</p>
    <div className="file-browser-comparison-controls"><label>递归层数 <select aria-label="比较递归层数" value={depth} onChange={event => setDepth(Number(event.target.value))}>{Array.from({ length: 9 }, (_, value) => <option key={value} value={value}>{value === 0 ? "仅当前层" : value}</option>)}</select></label><label><input type="checkbox" checked={content && !binary} onChange={event => { setContent(event.target.checked); setBinary(false); }} />核验 UTF-8 正文</label><label><input type="checkbox" checked={content && binary} onChange={event => { setContent(event.target.checked); setBinary(event.target.checked); }} />核验原始字节（含二进制）</label><button type="button" disabled={busy} onClick={() => setRun(current => ({ depth, content, binary, revision: current.revision + 1 }))}>重新比较</button></div>
    {content && <p>{binary ? `原始字节 SHA-256；本平台单文件最多 ${provider.digestByteLimit() / 1024 / 1024} MiB，累计最多 ${provider.digestByteLimit() * 2 / 1024 / 1024} MiB，无需文本解码。` : "按原始字节计算 SHA-256（包含 BOM 和换行差异），仅支持有效 UTF-8 文本；单文件最多 4 MiB，累计最多 32 MiB。"}不支持或超预算的项目显示未知，不读取截断预览作比较。</p>}
    <div className="file-browser-comparison-controls"><input aria-label="过滤比较结果" placeholder="过滤名称" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{busy && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setProgress("比较已取消，尚无完整比较结果。"); }}>取消比较</button>}</div>
    <p>本次范围：{run.depth === 0 ? "当前层" : `向下 ${run.depth} 层`} · {run.content ? run.binary ? "原始字节摘要（含二进制）" : "UTF-8 原始字节摘要" : "仅元信息"}。更改选项后需点击重新比较。</p>
    <p role="status">{progress}</p>{error && <p role="alert">{error}</p>}
    <table className="file-browser-comparison-table"><thead><tr><th>名称</th><th>结果</th><th>打开</th></tr></thead><tbody>{filtered.slice(currentPage * 200, (currentPage + 1) * 200).map(row => <tr key={row.name}><td title={row.name}>{row.name}</td><td>{run.binary && row.status === "content" ? "字节相同（SHA-256）" : run.binary && row.status === "content-different" ? "字节不同（SHA-256）" : labels[row.status]}{row.issue && <small className="file-browser-comparison-issue">{row.issue}</small>}</td><td>{row.left && <button type="button" aria-label={`左侧打开 ${row.name}`} onClick={() => onOpen(0, row.left!)}>左</button>}{row.right && <button type="button" aria-label={`右侧打开 ${row.name}`} onClick={() => onOpen(1, row.right!)}>右</button>}</td></tr>)}</tbody></table>
    <footer><button type="button" disabled={currentPage === 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(value => value + 1)}>下一页</button></footer>
  </section>;
}
