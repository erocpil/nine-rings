import type { RemoteProtocolReport } from "./remote-protocol";
import { captureSyncProgress } from "./operation-progress";

/** Continue bounded GET-only inspection; a partial report never grants authority. */
export async function completeCandidatePreflight(
  inspect: () => Promise<RemoteProtocolReport>,
  assertActive: () => void = () => {},
): Promise<RemoteProtocolReport> {
  const reportProgress = captureSyncProgress();
  for (let batch = 1; batch <= 8; batch++) {
    assertActive();
    reportProgress(`核验远端历史（第 ${batch} 批，最多 8 批）`, {
      historyBatch: batch,
    });
    const report = await inspect();
    assertActive();
    if (report.history === "complete") {
      reportProgress("远端历史核验完成，准备候选比较", {
        historyBatch: undefined,
      });
      return report;
    }
    if (report.support !== "legacy")
      throw Error(
        "远端快照链尚未完整核验，已停止候选比较；请检查链长度与读取预算。",
      );
  }
  throw Error(
    "远端历史尚未核验完，本次已达到 8 批上限，未生成候选或修改远端。请再次预检以复用已核验的历史；若反复无进展，请检查本机缓存是否可用。",
  );
}
