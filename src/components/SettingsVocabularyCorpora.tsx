import { useEffect, useRef, useState } from "react";
import { useConfirmation } from "./ConfirmationDialog";
import { Field } from "./SettingsFields";
import { listCorpora, importCorpus, exportCorpus, previewCorpusImport, removeCorpus, type CorpusManifest } from "../lib/vocabulary/corpus-store";
import { readVocabularyImport } from "../lib/vocabulary/package";
import { saveJsonBackup } from "../lib/local-backup-export";

export function SettingsVocabularyCorpora({ onMessage }: { onMessage: (message: string) => void }) {
  const [corpora, setCorpora] = useState<CorpusManifest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const { confirm, confirmationDialog } = useConfirmation();
  useEffect(() => {
    alive.current = true;
    void listCorpora().then(items => { if (alive.current) setCorpora(items); }, e => { if (alive.current) setError(String(e)); });
    return () => { alive.current = false; };
  }, []);
  const load = async (file: File) => {
    setBusy(true); setError("");
    try {
      const source = await readVocabularyImport(file);
      const preview = await previewCorpusImport(source.pack, source.markdownZip);
      const { pack } = preview;
      if (preview.unchangedPackage) { onMessage("词库内容未变化，无需更新"); return; }
      if (!alive.current || !await confirm({
        title: preview.expectedHash ? "更新独立词库" : "导入独立词库",
        description: `${pack.name} · ${pack.entries.length} 个词条 · 版本 ${pack.revision}。新增 ${preview.added}、修改 ${preview.changed}、移除 ${preview.removed}、不变 ${preview.unchanged} 词。不会修改或删除现有 Markdown 文档、个人记录。词库需单独导出，不包含在现行文档备份中。`,
        confirmLabel: "导入词库",
      })) return;
      await importCorpus(pack, preview.expectedHash);
      if (alive.current) { setCorpora(await listCorpora()); onMessage("词库已导入"); }
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <Field label="独立词库" desc="导入 Markdown ZIP、.nrvocab.json 或 gzip 压缩词库，不需要指定文档路径，导入后在词汇学习分栏显示。词库与文档备份、路径加密独立，请保留原包或使用下方导出。">
    {confirmationDialog}
    <div className="vocabulary-corpora-settings">
      <input ref={input} type="file" aria-label="选择词库文件" accept=".zip,.json,.gz,.nrvocab" hidden disabled={busy} onChange={async e => {
        const element = e.currentTarget;
        const file = element.files?.[0];
        try { if (file) await load(file); }
        finally { element.value = ""; }
      }} />
      <button className="settings-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "正在处理词库…" : "导入词库文件"}</button>
      {error && <p role="alert">{error}</p>}
      {corpora.map(c => <div key={c.id} className="vocabulary-corpus-row">
        <span>{c.name} · {c.entries.length} 词 · v{c.revision}</span>
        <button className="settings-btn" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try {
            const pack = await exportCorpus(c.id);
            const result = await saveJsonBackup(JSON.stringify(pack), `${c.id}.nrvocab.json`);
            if (alive.current && result) onMessage("词库已导出");
          } catch (e) { if (alive.current) setError(String(e)); }
          finally { if (alive.current) setBusy(false); }
        }}>导出词库</button>
        <button className="settings-btn" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try {
            if (!await confirm({ title: "卸载独立词库", description: `从本机卸载 ${c.name}（${c.entries.length} 词）。普通文档、阅读位置和折叠记录不受影响；重新导入相同词库可继续使用这些记录。请先保留原包或导出。`, confirmLabel: "卸载词库" })) return;
            await removeCorpus(c.id, c.hash);
            if (alive.current) { setCorpora(await listCorpora()); onMessage("词库已卸载"); }
          } catch (e) { if (alive.current) setError(String(e)); }
          finally { if (alive.current) setBusy(false); }
        }}>卸载词库</button>
      </div>)}
    </div>
  </Field>;
}
