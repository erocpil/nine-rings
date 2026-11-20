import { markdownAnchorOffsets } from "../../lib/local-files/markdown-link-anchors";
import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { localMarkdownLink, relativeMarkdownHref } from "../../lib/local-files/markdown-links";
import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import type { MarkdownLinkEdit } from "../../lib/local-files/markdown-link-repair";
import { checkMarkdownLinks, scanMarkdownFiles, type LinkIssue } from "./markdown-link-check";

export function MarkdownLinkCheckDialog({ node, rootId, source, provider, read, onClose, onRepair, onPrepareRepair }: {
  node: string; rootId: string; source: string; provider: BrowserDirectoryProvider;
  read: (node: string) => Promise<LocalFileSnapshot>;
  onClose: () => void; onPrepareRepair?: () => void; onRepair?: (edit: MarkdownLinkEdit) => void;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkMarkdownLinks>>>();
  const [error, setError] = useState("");
  const [repair, setRepair] = useState<LinkIssue>();
  const [replacement, setReplacement] = useState("");
  const [candidates, setCandidates] = useState<string[]>();
  const [confirming, setConfirming] = useState(false);
  const pendingRepair = useRef<AbortController>();
  useEffect(() => () => pendingRepair.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void checkMarkdownLinks(node, source, read, controller.signal).then(setResult, cause => {
      if (!controller.signal.aborted) setError(String(cause));
    });
    return () => controller.abort();
  }, [node, source, read]);
  useEffect(() => {
    if (!repair?.missingNode) return;
    const controller = new AbortController();
    const basename = repair.missingNode.split("/").pop();
    const matches: string[] = [];
    const neighbors: string[] = [];
    const parent = repair.missingNode.slice(0, repair.missingNode.lastIndexOf("/") + 1);
    void scanMarkdownFiles(provider, rootId, controller.signal, async name => {
      if (name === repair.missingNode) return;
      if (name.split("/").pop() === basename) matches.push(name);
      else if (neighbors.length < 20 && name.slice(0, name.lastIndexOf("/") + 1) === parent) neighbors.push(name);
      if (matches.length >= 20) return false;
    }).then(() => { if (!controller.signal.aborted) setCandidates([...matches, ...neighbors].slice(0, 20)); }, cause => {
      if (!controller.signal.aborted) setError(String(cause));
    });
    return () => controller.abort();
  }, [provider, rootId, repair]);
  return <WorkspaceDialog title="检查文档链接" onClose={onClose}>
    <div className="workbench-markdown-link-dialog">
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p role="status">正在检查本地链接…</p>}
      {result && <p role="status">{result.issues.length ? `发现 ${result.issues.length} 处链接问题` : "已检查的本地链接有效"}{result.limited && "（达到扫描上限）"}</p>}
      {result?.issues.map(issue => <div key={issue.link.key}>
        <p>第 {issue.link.line} 行 · <code>{issue.link.href}</code> · {issue.message}</p>
        {onPrepareRepair && issue.link.range && <button type="button" onClick={onPrepareRepair}>切换到源码修复</button>}
        {onRepair && issue.link.range && !repair && <button type="button" onClick={() => {
          setReplacement(issue.link.href); setRepair(issue); setCandidates(undefined); setError("");
        }}>修复第 {issue.link.line} 行链接</button>}
      </div>)}
      {repair && onRepair && <form onSubmit={event => {
        event.preventDefault();
        if (pendingRepair.current) return;
        const controller = new AbortController();
        pendingRepair.current = controller;
        setConfirming(true); setError("");
        void (async () => {
          try {
            const target = localMarkdownLink(node, replacement);
            const text = target.node === node ? source : (await read(target.node)).source;
            if (controller.signal.aborted) return;
            if (target.fragment && !markdownAnchorOffsets(text).has(target.fragment)) throw new Error("新链接的标题或锚点不存在");
            onRepair({ link: repair.link, href: replacement });
          } catch (cause) {
            if (!controller.signal.aborted) setError(String(cause));
          } finally {
            pendingRepair.current = undefined;
            if (!controller.signal.aborted) setConfirming(false);
          }
        })();
      }}>
        {candidates?.map(candidate => <button key={candidate} type="button" onClick={() => {
          const fragment = repair.link.href.match(/#.*/)?.[0] ?? "";
          setReplacement(relativeMarkdownHref(node, candidate) + fragment);
        }}>{candidate}</button>)}
        <label>新链接路径<input required value={replacement} onChange={event => setReplacement(event.target.value)} /></label>
        <button type="submit" disabled={confirming}>确认替换链接</button>
        <button type="button" disabled={confirming} onClick={() => { setRepair(undefined); setError(""); }}>取消替换</button>
      </form>}
    </div>
  </WorkspaceDialog>;
}
