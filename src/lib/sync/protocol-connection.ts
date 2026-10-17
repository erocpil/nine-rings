import { canonicalDigest } from "./canonical-codec";
import {
  rememberProtocolEnabled,
  readProtocolObservation,
} from "./protocol-switch";
import type { RemoteProtocolReport } from "./remote-protocol";
import { parseSyncJson } from "./strict-json";
const prefix = "nr:sync-protocol-connection:v1:";
type Connection = { owner: string; repo: string; path: string };
const key = async (c: Connection) =>
  prefix +
  (await canonicalDigest({
    owner: c.owner.toLowerCase(),
    repo: c.repo.toLowerCase(),
    path: c.path,
  }));
type PendingMarker = {
  version: 1;
  kind: "pending" | "cancelled";
  spaceId: string;
  attemptId: string;
};
function pendingMarker(raw: string | null): PendingMarker | null {
  try {
    const value = parseSyncJson(raw ?? "") as PendingMarker;
    return value.version === 1 &&
      ["pending", "cancelled"].includes(value.kind) &&
      /^[a-f0-9]{64}$/.test(value.spaceId) &&
      typeof value.attemptId === "string" &&
      value.attemptId.length > 0 &&
      value.attemptId.length <= 128
      ? value
      : null;
  } catch {
    return null;
  }
}
async function markerLock<T>(
  name: string,
  action: () => T | Promise<T>,
): Promise<T> {
  return globalThis.navigator?.locks
    ? navigator.locks.request(
        `nr:protocol-marker:${name}`,
        { mode: "exclusive" },
        action,
      )
    : action();
}
/** Conservative cross-branch guard: changing default branch cannot erase an observed enablement. */
export async function assertLegacyConnectionAllowed(
  connection: Connection,
  storage: Pick<Storage, "getItem">,
): Promise<void> {
  let marker: string | null;
  try {
    marker = storage.getItem(await key(connection));
  } catch {
    throw Error("本机协议记录不可用，已停止同步");
  }
  if (marker !== null)
    throw Error(
      "此备份连接已观察到新协议，当前版本停止旧格式 Push/Pull；请使用受支持版本并执行协议预检",
    );
}
/** A detected control/header is enough to require inspection, even if its version is unsupported. */
export async function markProtocolInspectionRequired(
  connection: Connection,
  spaceId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  pendingAttemptId?: string,
): Promise<void> {
  const markerKey = await key(connection);
  if (pendingAttemptId && !globalThis.navigator?.locks)
    throw Error("协议检查锁不可用");
  await markerLock(markerKey, () => {
    const existing = storage.getItem(markerKey),
      pending = pendingMarker(existing);
    if (!pendingAttemptId) {
      if (existing === null || pending) storage.setItem(markerKey, spaceId);
    } else if (
      existing === null ||
      (pending?.kind === "cancelled" && pending.spaceId === spaceId)
    ) {
      storage.setItem(
        markerKey,
        JSON.stringify({
          version: 1,
          kind: "pending",
          spaceId,
          attemptId: pendingAttemptId,
        }),
      );
    } else if (
      pending &&
      (pending.spaceId !== spaceId || pending.attemptId !== pendingAttemptId)
    ) {
      throw Error("未完成的协议检查记录不匹配，请先核实或取消原发布计划");
    }
    if (storage.getItem(markerKey) === null)
      throw Error("本机协议防降级记录未可靠保存");
  });
}
export async function observeRemoteProtocol(
  report: RemoteProtocolReport,
  storage: Pick<Storage, "getItem" | "setItem">,
): Promise<void> {
  const markerKey = await key(report.space);
  if (report.evidence.control.state !== "enabled") {
    await markerLock(markerKey, async () => {
      const existing = storage.getItem(markerKey),
        observation = readProtocolObservation(report.spaceId, storage);
      if (existing === null && observation.state === "none") return;
      const pending = pendingMarker(existing);
      if (
        pending &&
        pending.spaceId === report.spaceId &&
        observation.state === "none" &&
        report.history === "complete" &&
        report.evidence.legacyHistory === "verified-never-enabled"
      ) {
        if (pending.kind === "cancelled") return;
        const { readValidatedPublication } =
          await import("./publication-recovery");
        const attempt = await readValidatedPublication(report.spaceId);
        if (
          attempt.id === pending.attemptId &&
          ["PREPARED", "OBJECTS_READY", "REJECTED", "ABORTED"].includes(
            attempt.phase,
          )
        ) {
          if (attempt.phase === "ABORTED")
            storage.setItem(
              markerKey,
              JSON.stringify({ ...pending, kind: "cancelled" }),
            );
          return;
        }
      }
      throw Error(
        "协议状态异常：本机已观察开启或发布结果不明，不能降级；请先核实恢复记录",
      );
    });
    return;
  }
  // Persist the conservative refusal first; a failed fact write must not allow a subsequent legacy upload.
  await markProtocolInspectionRequired(report.space, report.spaceId, storage);
  rememberProtocolEnabled(report.spaceId, report.evidence, storage);
}
