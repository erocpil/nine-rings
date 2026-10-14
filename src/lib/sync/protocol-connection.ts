import { canonicalDigest } from "./canonical-codec";
import {
  rememberProtocolEnabled,
  readProtocolObservation,
} from "./protocol-switch";
import type { RemoteProtocolReport } from "./remote-protocol";
const prefix = "nr:sync-protocol-connection:v1:";
type Connection = { owner: string; repo: string; path: string };
const key = async (c: Connection) =>
  prefix +
  (await canonicalDigest({
    owner: c.owner.toLowerCase(),
    repo: c.repo.toLowerCase(),
    path: c.path,
  }));
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
): Promise<void> {
  const markerKey = await key(connection);
  if (storage.getItem(markerKey) === null) storage.setItem(markerKey, spaceId);
  if (storage.getItem(markerKey) === null)
    throw Error("本机协议防降级记录未可靠保存");
}
export async function observeRemoteProtocol(
  report: RemoteProtocolReport,
  storage: Pick<Storage, "getItem" | "setItem">,
): Promise<void> {
  const markerKey = await key(report.space);
  const existing = storage.getItem(markerKey);
  const observation = readProtocolObservation(report.spaceId, storage);
  if (report.evidence.control.state !== "enabled") {
    if (existing !== null || observation.state !== "none")
      throw Error("协议状态异常：本机已观察开启或记录不可用，不能降级");
    return;
  }
  // Persist the conservative refusal first; a failed fact write must not allow a subsequent legacy upload.
  if (existing === null) storage.setItem(markerKey, report.spaceId);
  if (storage.getItem(markerKey) === null)
    throw Error("本机协议防降级记录未可靠保存");
  rememberProtocolEnabled(report.spaceId, report.evidence, storage);
}
