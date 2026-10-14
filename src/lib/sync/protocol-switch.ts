/** Local, monotonic observations and pure switch preflight. No GitHub writes. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import {
  CURRENT_SYNC_CAPABILITIES,
  type SyncCapabilities,
} from "./protocol-capabilities";
import type { CandidateReview } from "./candidate-write-policy";

export const PROTOCOL_OBSERVATION_PREFIX = "nr:sync-protocol:v1:";
export interface SyncSpace {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export async function syncSpaceId(space: SyncSpace): Promise<string> {
  const name = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  if (
    !name.test(space.owner) ||
    !name.test(space.repo) ||
    !space.branch ||
    !space.path ||
    [space.branch, space.path].some(
      (s) =>
        s.trim() !== s ||
        Array.from(s).some(
          (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
        ),
    ) ||
    space.path.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw Error("同步空间无效");
  return canonicalDigest({
    host: "api.github.com",
    owner: space.owner.toLowerCase(),
    repo: space.repo.toLowerCase(),
    branch: space.branch,
    path: space.path,
  });
}
export interface ProtocolObservation {
  version: 1;
  spaceId: string;
  firstCommit: string;
  format: number;
  codec: number;
}
export type ObservationStatus =
  | { state: "none" }
  | { state: "observed"; record: ProtocolObservation }
  | { state: "unavailable" };
type ObservationStorage = Pick<Storage, "getItem" | "setItem">;

export function readProtocolObservation(
  spaceId: string,
  storage: Pick<Storage, "getItem">,
): ObservationStatus {
  if (!digest(spaceId)) return { state: "unavailable" };
  try {
    const raw = storage.getItem(PROTOCOL_OBSERVATION_PREFIX + spaceId);
    if (raw === null) return { state: "none" };
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      value.version !== 1 ||
      value.spaceId !== spaceId ||
      !sha(value.firstCommit) ||
      !positive(value.format) ||
      !positive(value.codec)
    )
      return { state: "unavailable" };
    return {
      state: "observed",
      record: {
        version: 1,
        spaceId,
        firstCommit: value.firstCommit,
        format: value.format,
        codec: value.codec,
      },
    };
  } catch {
    return { state: "unavailable" };
  }
}
export interface PinnedProtocolEvidence {
  head: string;
  control: {
    commit: string;
    state: "absent" | "enabled" | "unknown";
    format?: number;
    codec?: number;
  };
  snapshot: {
    commit: string;
    header: "absent" | "present" | "unknown";
    latestId: string;
    headerId?: string;
    format?: number;
    codec?: number;
    parentChain: "verified" | "unknown" | "invalid";
  };
  legacyHistory: "verified-never-enabled" | "unknown";
}
function pinned(evidence: PinnedProtocolEvidence): boolean {
  return (
    sha(evidence.head) &&
    evidence.control.commit === evidence.head &&
    evidence.snapshot.commit === evidence.head
  );
}
function enabled(evidence: PinnedProtocolEvidence): boolean {
  return (
    pinned(evidence) &&
    evidence.control.state === "enabled" &&
    positive(evidence.control.format) &&
    positive(evidence.control.codec) &&
    evidence.snapshot.header === "present" &&
    !!evidence.snapshot.latestId &&
    evidence.snapshot.latestId === evidence.snapshot.headerId &&
    evidence.snapshot.format === evidence.control.format &&
    evidence.snapshot.codec === evidence.control.codec &&
    evidence.snapshot.parentChain === "verified"
  );
}

/** Called only with already verified, pinned evidence. First observation can never be cleared here. */
export function rememberProtocolEnabled(
  spaceId: string,
  evidence: PinnedProtocolEvidence,
  storage: ObservationStorage,
): ProtocolObservation {
  if (!digest(spaceId) || !enabled(evidence))
    throw Error("协议开启证据未核实，拒绝记录");
  const previous = readProtocolObservation(spaceId, storage);
  if (previous.state === "unavailable")
    throw Error("本机协议记录不可用，拒绝切换");
  if (previous.state === "observed") return previous.record;
  const value: ProtocolObservation = {
    version: 1,
    spaceId,
    firstCommit: evidence.head,
    format: evidence.control.format!,
    codec: evidence.control.codec!,
  };
  try {
    storage.setItem(
      PROTOCOL_OBSERVATION_PREFIX + spaceId,
      JSON.stringify(value),
    );
    const verified = readProtocolObservation(spaceId, storage);
    if (
      verified.state !== "observed" ||
      canonicalJson(verified.record) !== canonicalJson(value)
    )
      throw Error();
  } catch {
    throw Error("本机协议记录未可靠保存，拒绝切换");
  }
  return value;
}

export interface SwitchPrerequisites {
  localRevision: string;
  backup: {
    localRevision: string;
    sha256: string;
    method: "desktop-verified" | "browser-user-confirmed" | "browser-started";
  } | null;
  participants: { confirmed: boolean; minimumVersion: string } | null;
  payload: CandidateReview;
  publicationRecoveryReady: boolean;
}
export type SwitchReason =
  | "local-state-unavailable"
  | "mixed-revision"
  | "remote-unknown"
  | "protocol-anomaly"
  | "downgrade"
  | "join-required"
  | "history-unknown"
  | "backup-unverified"
  | "participants-unconfirmed"
  | "payload-unsupported"
  | "capability-unsupported"
  | "publication-not-ready";
/** A preflight result is not a publication token. The final publisher must recheck its frozen plan. */
export function reviewProtocolSwitch(
  spaceId: string,
  evidence: PinnedProtocolEvidence,
  observation: ObservationStatus,
  prerequisites: SwitchPrerequisites,
  capabilities: SyncCapabilities = CURRENT_SYNC_CAPABILITIES,
): { ready: boolean; reasons: SwitchReason[] } {
  const reasons = new Set<SwitchReason>();
  if (
    !digest(spaceId) ||
    observation.state === "unavailable" ||
    (observation.state === "observed" && observation.record.spaceId !== spaceId)
  )
    reasons.add("local-state-unavailable");
  if (!pinned(evidence)) reasons.add("mixed-revision");
  if (
    evidence.control.state === "unknown" ||
    evidence.snapshot.header === "unknown"
  )
    reasons.add("remote-unknown");
  if (evidence.control.state === "absent") {
    if (observation.state === "observed") reasons.add("downgrade");
    if (evidence.snapshot.header !== "absent") reasons.add("protocol-anomaly");
    if (evidence.legacyHistory !== "verified-never-enabled")
      reasons.add("history-unknown");
  } else if (evidence.control.state === "enabled") {
    if (!enabled(evidence)) reasons.add("protocol-anomaly");
    // Joining an enabled space belongs to the checkpoint/baseline workflow, not bootstrap.
    reasons.add("join-required");
  }
  const backup = prerequisites.backup;
  if (
    !prerequisites.localRevision ||
    !backup ||
    !["desktop-verified", "browser-user-confirmed"].includes(backup.method) ||
    !digest(backup.sha256) ||
    backup.localRevision !== prerequisites.localRevision
  )
    reasons.add("backup-unverified");
  if (
    !prerequisites.participants?.confirmed ||
    !/^\d+\.\d+\.\d+$/.test(prerequisites.participants.minimumVersion)
  )
    reasons.add("participants-unconfirmed");
  if (
    !prerequisites.payload.eligible ||
    Object.keys(prerequisites.payload.issues).length
  )
    reasons.add("payload-unsupported");
  if (
    !capabilities.formats.includes(1) ||
    !capabilities.codecs.includes(1) ||
    capabilities.read < 1 ||
    capabilities.write < 1 ||
    prerequisites.payload.requiredFeatures.some(
      (f) =>
        !capabilities.readFeatures.includes(f) ||
        !capabilities.writeFeatures.includes(f),
    )
  )
    reasons.add("capability-unsupported");
  if (!prerequisites.publicationRecoveryReady)
    reasons.add("publication-not-ready");
  return { ready: reasons.size === 0, reasons: [...reasons].sort() };
}
