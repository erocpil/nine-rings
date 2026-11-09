import type { LocalFileSnapshot } from "./file-model";

export interface LocalSourceSavePorts {
  submitted: string;
  base: LocalFileSnapshot;
  currentSource(): string;
  write(source: string, base: LocalFileSnapshot): Promise<LocalFileSnapshot>;
  /** Rebase the live session immediately after the confirmed disk receipt. */
  committed(saved: LocalFileSnapshot): void;
  keepDraft(source: string, base: LocalFileSnapshot): Promise<void>;
  clearDraft(): Promise<void>;
}
/** One save protocol for every file host. A draft-store failure after a disk
 * receipt is a recovery warning, never a failed/retryable filesystem write. */
export async function saveLocalSource(ports: LocalSourceSavePorts) {
  const saved = await ports.write(ports.submitted, ports.base);
  try { ports.committed(saved); }
  catch (cause) { return { saved, clean: false, recoveryIssue: `磁盘保存已完成，但编辑器状态更新失败，请核对文件：${String(cause)}` }; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = ports.currentSource(), clean = current === ports.submitted;
    try {
      if (clean) await ports.clearDraft();
      else await ports.keepDraft(current, saved);
    } catch (cause) {
      return { saved, clean: ports.currentSource() === ports.submitted, recoveryIssue: `磁盘保存已完成，但恢复草稿更新失败：${String(cause)}` };
    }
    if (current === ports.currentSource()) return { saved, clean, recoveryIssue: "" };
  }
  return { saved, clean: ports.currentSource() === ports.submitted, recoveryIssue: "磁盘保存已完成；之后的编辑持续变化，请暂时停止输入并检查恢复草稿。" };
}
