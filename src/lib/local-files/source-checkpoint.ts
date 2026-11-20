import type { LocalFileSnapshot } from "./file-model";
import type { LocalDraftStore } from "./recovery";

interface LocalSourceCheckpoint {
  identity: string;
  drafts: Pick<LocalDraftStore, "write" | "remove">;
  read(): { source: string; base: LocalFileSnapshot | null };
  isSaving(): boolean;
  retainClean?: boolean;
}

export async function checkpointLocalSource({
  identity, drafts, read, isSaving, retainClean = false,
}: LocalSourceCheckpoint): Promise<void> {
  const readIdle = () => {
    if (isSaving()) throw new Error("文件正在保存，请等待完成后重试。");
    return read();
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { source, base } = readIdle();
    if (!base) return;
    if (!retainClean && source === base.source) {
      await drafts.remove(identity);
    } else {
      await drafts.write({
        identity, source, baseSource: base.source, baseRevision: base.revision,
        bom: base.bom, lineEnding: base.lineEnding, savedAt: Date.now(),
      });
    }
    const current = readIdle();
    if (current.base === base && current.source === source) return;
  }
  throw new Error("内容持续变化，尚不能安全离开；请暂停输入后重试。");
}
