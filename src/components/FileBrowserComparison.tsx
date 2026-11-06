import { useEffect, useRef, useState } from "react";
import { compareBrowserDirectories, type BrowserDirectory, type ComparedBrowserEntry } from "../lib/local-files/browser-tools";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import type { FileNode } from "../lib/local-files/service";
const labels = { left: "仅左侧", right: "仅右侧", type: "类型不同", different: "元信息不同", metadata: "元信息一致", directory: "目录 · 未比较内部", unknown: "读取失败 · 未知" };
export function FileBrowserComparison({ directories, names, provider, onOpen }: { directories: [BrowserDirectory, BrowserDirectory]; names: [string, string]; provider: ReturnType<typeof localDirectoryProvider>; onOpen: (side: 0 | 1, node: FileNode) => void }) {
  const [rows, setRows] = useState<ComparedBrowserEntry[]>([]), [progress, setProgress] = useState("正在枚举目录…"), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const operation = new AbortController(); controller.current = operation;
    void compareBrowserDirectories(provider, directories, operation.signal, message => { if (!operation.signal.aborted) setProgress(message); }).then(result => { if (!operation.signal.aborted) { setRows(result); setProgress(`完成，共 ${result.length} 项`); } }).catch(reason => { if (!operation.signal.aborted) setError(String(reason)); }).finally(() => { if (!operation.signal.aborted) setBusy(false); });
    return () => operation.abort();
  }, [directories, provider]);
  const filtered = rows.filter(row => row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 200) - 1), currentPage = Math.min(page, lastPage);
  return <section aria-label="目录比较结果"><p>{names[0]} ↔ {names[1]}</p><p>仅比较当前层级的名称、类型、大小和修改时间（含隐藏项），不读取正文或递归比较目录。“元信息一致”不代表内容相同。</p>
    <div className="file-browser-comparison-controls"><input aria-label="过滤比较结果" placeholder="过滤名称" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{busy && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setProgress("比较已取消，尚无完整比较结果。"); }}>取消比较</button>}</div>
    <p role="status">{progress}</p>{error && <p role="alert">{error}</p>}
    <table className="file-browser-comparison-table"><thead><tr><th>名称</th><th>结果</th><th>打开</th></tr></thead><tbody>{filtered.slice(currentPage * 200, (currentPage + 1) * 200).map(row => <tr key={row.name}><td title={row.name}>{row.name}</td><td title={row.issue}>{labels[row.status]}</td><td>{row.left && <button type="button" aria-label={`左侧打开 ${row.name}`} onClick={() => onOpen(0, row.left!)}>左</button>}{row.right && <button type="button" aria-label={`右侧打开 ${row.name}`} onClick={() => onOpen(1, row.right!)}>右</button>}</td></tr>)}</tbody></table>
    <footer><button type="button" disabled={currentPage === 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(value => value + 1)}>下一页</button></footer>
  </section>;
}
