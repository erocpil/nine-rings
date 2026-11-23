import { useEffect, useState } from "react";
import { TextDiffView } from "./TextDiffView";
import type { BrowserDirectoryProvider, BrowserTextLocation } from "../lib/local-files/browser-contract";
import type { BrowserDirectory } from "../lib/local-files/browser-compare";
import type { FileNode, LocalFileSnapshot } from "../lib/local-files/file-model";

export function FileBrowserTextComparison({ directories, files, provider, onBack, onOpen }: {
  directories: [BrowserDirectory, BrowserDirectory]; files: [FileNode, FileNode]; provider: BrowserDirectoryProvider;
  onBack: () => void; onOpen: (side: 0 | 1, node: FileNode, location: BrowserTextLocation) => void;
}) {
  const [snapshots, setSnapshots] = useState<LocalFileSnapshot[]>();
  const [error, setError] = useState("");
  const [side, setSide] = useState<0 | 1>(0);
  const [line, setLine] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(files.map((file, index) => provider.textSnapshot!(directories[index].rootId, file.id, controller.signal))).then(result => {
      if (controller.signal.aborted) return;
      if (result.some(snapshot => snapshot.source.includes("\0"))) throw new Error("文件含二进制数据");
      if (result.some(snapshot => snapshot.source.split("\n").length > 10000)) throw new Error("双栏差异每个文件最多显示 10000 行");
      setSnapshots(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [directories, files, provider]);
  const lines = snapshots?.[side].source.split("\n");
  const open = () => {
    if (!snapshots || !lines || !Number.isInteger(line) || line < 1 || line > lines.length) return;
    const from = lines.slice(0, line - 1).reduce((offset, value) => offset + value.length + 1, 0);
    onOpen(side, files[side], { from, to: from + lines[line - 1].length, revision: snapshots[side].revision });
  };
  return <section className="document-comparison file-browser-text-comparison" aria-label="双文件差异">
    <button type="button" onClick={onBack}>返回比较</button>
    {error ? <p role="alert">{error}</p> : !snapshots ? <p role="status">正在读取两份文件…</p> :
      <TextDiffView left={snapshots[0].source} right={snapshots[1].source} leftLabel={`左侧 · ${files[0].id}`} rightLabel={`右侧 · ${files[1].id}`}
        controls={<>
          <select aria-label="打开哪一侧" value={side} onChange={event => { setSide(event.target.value === "1" ? 1 : 0); setLine(1); }}><option value="0">左侧</option><option value="1">右侧</option></select>
          <input aria-label="行号" type="number" min={1} max={lines?.length} value={line || ""} onChange={event => setLine(Number(event.target.value))} />
          <button type="button" disabled={!Number.isInteger(line) || line < 1 || line > (lines?.length ?? 0)} onClick={open}>在编辑器打开该行</button>
        </>} />}
  </section>;
}
