import { useEffect, useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { MAX_SOURCE_BYTES, type LocalFileSnapshot } from "../../lib/local-files/file-model";
import { applyMarkdownLinkEdits, planMarkdownLinkEdits, type MarkdownLinkEdit, type MarkdownPathMove } from "../../lib/local-files/markdown-link-repair";
import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import { scanMarkdownFiles } from "./markdown-link-check";

export interface MarkdownMoveBatch { rootId: string; moves: readonly MarkdownPathMove[]; updated: Set<string> }
interface Candidate { node: string; base: LocalFileSnapshot; changes: MarkdownLinkEdit[] }

export function MarkdownLinkUpdateDialog({ batch, provider, read, write, onClose, onComplete }: {
  batch: MarkdownMoveBatch;
  provider: BrowserDirectoryProvider;
  read: (rootId: string, node: string) => Promise<LocalFileSnapshot>;
  write: (rootId: string, node: string, source: string, base: LocalFileSnapshot) => Promise<void>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [review, setReview] = useState<{ candidates: Candidate[]; skipped: string[]; limited: boolean }>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const candidates: Candidate[] = [], issues: string[] = [];
    let files = 0, bytes = 0;
    void scanMarkdownFiles(provider, batch.rootId, controller.signal, async (node, size) => {
      if (batch.updated.has(node)) return;
      if (++files > 1000 || bytes + size > 32 * 1024 * 1024) return false;
      if (size > MAX_SOURCE_BYTES) { issues.push(`${node}：超过 Markdown 读取上限`); return; }
      bytes += size;
      try {
        const base = await read(batch.rootId, node);
        controller.signal.throwIfAborted();
        bytes += Math.max(0, base.size - size);
        if (bytes > 32 * 1024 * 1024) return false;
        const changes = planMarkdownLinkEdits(base.source, node, batch.moves);
        if (changes.length) candidates.push({ node, base, changes });
      } catch (error) { controller.signal.throwIfAborted(); issues.push(`${node}：${String(error)}`); }
    }).then(({ skipped, limited }) => {
      if (controller.signal.aborted) return;
      setReview({ candidates, skipped: [...issues, ...skipped], limited });
      setSelected(new Set(candidates.map(file => file.node)));
    }, cause => { if (!controller.signal.aborted) setErrors([String(cause)]); });
    return () => controller.abort();
  }, [batch, provider, read]);
  const apply = async () => {
    if (!review || busy || !selected.size) return;
    setBusy(true);
    const completed = new Set<string>(), failures: string[] = [];
    for (const file of review.candidates) {
      if (!selected.has(file.node)) continue;
      try {
        await write(batch.rootId, file.node, applyMarkdownLinkEdits(file.base.source, file.changes), file.base);
        completed.add(file.node);
        batch.updated.add(file.node);
      } catch (error) { failures.push(`${file.node}：${String(error)}`); }
    }
    setSaved(value => value + completed.size);
    setErrors(failures);
    setReview({ ...review, candidates: review.candidates.filter(file => !completed.has(file.node)) });
    setSelected(new Set([...selected].filter(node => !completed.has(node))));
    setBusy(false);
    if (!failures.length && completed.size === review.candidates.length && !review.limited && !review.skipped.length) onComplete();
  };
  return <WorkspaceDialog title="预览 Markdown 引用更新" onClose={() => {
    if (busy) return;
    if (review && !review.candidates.length && !review.skipped.length && !review.limited) onComplete();
    onClose();
  }}>
    <div className="workbench-markdown-link-dialog">
      {saved > 0 && <p role="status">已更新 {saved} 份文档。</p>}
      {errors.map(error => <p role="alert" key={error}>{error}</p>)}
      {!review && errors.length === 0 && <p role="status">正在扫描授权目录…</p>}
      {review && <>
        <p>{review.candidates.length ? `发现 ${review.candidates.length} 份文档可更新。` : "没有待更新的 Markdown 文档。"}{review.limited && "已达到扫描上限。"}{review.skipped.length > 0 && `跳过 ${review.skipped.length} 项。`}</p>
        {review.skipped.length > 0 && <details><summary>查看跳过原因</summary><ul>{review.skipped.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {review.candidates.map(file => <section key={file.node}>
          <label><input type="checkbox" checked={selected.has(file.node)} disabled={busy} onChange={event => {
            const next = new Set(selected);
            if (event.target.checked) next.add(file.node);
            else next.delete(file.node);
            setSelected(next);
          }} />{file.node}</label>
          <ul>{file.changes.map(({ link, href }) => <li key={link.key}>第 {link.line} 行 · <code>{link.href}</code> → <code>{href}</code></li>)}</ul>
        </section>)}
        <button type="button" disabled={busy || !selected.size} onClick={() => void apply()}>{busy ? "正在更新…" : "确认更新所选文档"}</button>
      </>}
    </div>
  </WorkspaceDialog>;
}
