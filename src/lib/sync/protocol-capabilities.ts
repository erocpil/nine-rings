export interface SyncCapabilities {
  formats: readonly number[];
  codecs: readonly number[];
  read: number;
  write: number;
  readFeatures: readonly string[];
  writeFeatures: readonly string[];
}
/** No released client is yet certified to round-trip the new envelope. */
export const CURRENT_SYNC_CAPABILITIES: SyncCapabilities = Object.freeze({
  formats: Object.freeze([]),
  codecs: Object.freeze([]),
  read: 0,
  write: 0,
  readFeatures: Object.freeze([]),
  writeFeatures: Object.freeze([]),
});
export class SyncProtocolError extends Error {
  constructor(
    readonly code:
      "invalid-header" | "identity-mismatch" | "unsupported" | "missing-header",
  ) {
    super(
      {
        "invalid-header": "同步协议头无效，未应用数据",
        "identity-mismatch": "同步快照身份与指针不一致，未应用数据",
        unsupported:
          "当前版本尚不支持此同步协议，请使用支持该协议的版本；未应用数据",
        "missing-header": "同步协议头缺失，不能自动降级为旧格式",
      }[code],
    );
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const level = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 1;
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= 256 &&
  !Array.from(v).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const features = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
const identity = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    value.slice(11, 13) < "24"
  );
}

export interface SyncHeader {
  kind: "nine-rings.sync-snapshot";
  format: number;
  codec: number;
  id: string;
  requires: {
    read: number;
    write: number;
    readFeatures: string[];
    writeFeatures: string[];
  };
  parent: null | { id: string; sha256: string };
  createdAt: string;
  writtenBy: { app: string; platform: string; deviceId: string };
}
/** Structural inspection never grants read/write support or applies the payload. */
export function inspectSyncHeader(
  value: unknown,
  expectedId?: string,
): SyncHeader {
  const h = value;
  if (
    !record(h) ||
    h.kind !== "nine-rings.sync-snapshot" ||
    !level(h.format) ||
    !level(h.codec) ||
    !identity(h.id) ||
    !record(h.requires) ||
    !level(h.requires.read) ||
    !level(h.requires.write) ||
    !features(h.requires.readFeatures) ||
    !features(h.requires.writeFeatures) ||
    !timestamp(h.createdAt) ||
    !record(h.writtenBy) ||
    !text(h.writtenBy.app) ||
    !text(h.writtenBy.platform) ||
    !text(h.writtenBy.deviceId) ||
    !(
      h.parent === null ||
      (record(h.parent) &&
        identity(h.parent.id) &&
        typeof h.parent.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(h.parent.sha256))
    )
  )
    throw new SyncProtocolError("invalid-header");
  if (expectedId !== undefined && h.id !== expectedId)
    throw new SyncProtocolError("identity-mismatch");
  return h as unknown as SyncHeader;
}

/** Pure capability assessment, not proof of ancestry or safe storage round-trip. */
export function assertSyncCapabilities(
  bundle: unknown,
  options: {
    operation: "read" | "write";
    capabilities?: SyncCapabilities;
    expectedId?: string;
    requireHeader?: boolean;
  },
): "legacy" | "envelope" {
  if (!record(bundle)) throw new SyncProtocolError("invalid-header");
  if (!Object.prototype.hasOwnProperty.call(bundle, "header")) {
    if (options.requireHeader) throw new SyncProtocolError("missing-header");
    return "legacy";
  }
  const h = inspectSyncHeader(bundle.header, options.expectedId);
  const c = options.capabilities ?? CURRENT_SYNC_CAPABILITIES;
  if (
    !c.formats.includes(h.format) ||
    !c.codecs.includes(h.codec) ||
    c.read < h.requires.read ||
    h.requires.readFeatures.some((f) => !c.readFeatures.includes(f)) ||
    (options.operation === "write" &&
      (c.write < h.requires.write ||
        h.requires.writeFeatures.some((f) => !c.writeFeatures.includes(f))))
  )
    throw new SyncProtocolError("unsupported");
  return "envelope";
}
