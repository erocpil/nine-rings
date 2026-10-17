import { canonicalDigest } from "../src/lib/sync/canonical-codec";
import { parseSyncJson } from "../src/lib/sync/strict-json";
import {
  persistPreparedAttempt,
  readPublicationAttempt,
  transitionPublication,
  readAcceptedEntities,
  listPublicationSummaries,
} from "../src/lib/sync/publication-store";
import {
  savePullAttempt,
  readPullAttempt,
  listPullSummaries,
} from "../src/lib/sync/pull-store";

const { performance, TextEncoder } = globalThis;
const assert = (value) => {
  if (!value) throw Error("Journal storage invariant failed");
};
const reader = (kind) =>
  kind === "publication" ? readPublicationAttempt : readPullAttempt;

// Real records captured by the isolated service rehearsal. No recovery/publish API is invoked.
globalThis.syncBrowserProbe = async (source) => {
  const { kind, record } = parseSyncJson(source);
  assert(
    ["publication", "pull"].includes(kind) && record && record.version === 1,
  );
  assert(record.phase === (kind === "publication" ? "PREPARED" : "APPLYING"));
  const stages = [];
  const stage = async (name, action) => {
    const start = performance.now();
    const result = await action();
    stages.push({
      name,
      ms: Math.round(performance.now() - start),
      ...(await globalThis.sampleSyncMemory()),
    });
    return result;
  };
  const read = reader(kind);
  assert((await read(record.spaceId)) === null);
  const initialWrite = (guard) =>
    kind === "publication"
      ? persistPreparedAttempt(record, guard)
      : savePullAttempt(record, null, guard);
  const rejected = await Promise.allSettled([
    initialWrite(() => {
      throw Error("probe cancellation");
    }),
  ]);
  assert(
    rejected[0].status === "rejected" && (await read(record.spaceId)) === null,
  );
  const afterAbort =
    kind === "publication"
      ? await listPublicationSummaries()
      : await listPullSummaries();
  assert(afterAbort.length === 0);
  await stage("journal-write", () => initialWrite(() => {}));
  const restored = await stage("journal-read", () => read(record.spaceId));
  assert((await canonicalDigest(restored)) === (await canonicalDigest(record)));
  const next = { ...record, phase: "NEEDS_REVIEW" };
  const move = () =>
    kind === "publication"
      ? transitionPublication(record, "OBJECTS_READY", "c".repeat(40))
      : savePullAttempt(next, record);
  const races = await stage("compare-and-transition-race", () =>
    Promise.allSettled([move(), move()]),
  );
  assert(races.filter((result) => result.status === "fulfilled").length === 1);
  let pending = await read(record.spaceId);
  if (kind === "publication")
    pending = await transitionPublication(pending, "UNKNOWN");
  assert((await canonicalDigest(pending)) !== (await canonicalDigest(record)));
  assert((await readAcceptedEntities(record.spaceId)).length === 0);
  const summaries =
    kind === "publication"
      ? await listPublicationSummaries()
      : await listPullSummaries();
  assert(summaries.length === 1 && summaries[0].phase === pending.phase);
  return {
    kind,
    journalBytes: new TextEncoder().encode(source).length,
    phase: pending.phase,
    raceWinners: 1,
    accepted: 0,
    stages,
    reloadDigest: {
      kind,
      spaceId: record.spaceId,
      sha256: await canonicalDigest(pending),
      phase: pending.phase,
    },
  };
};

globalThis.syncStorageReload = async (expected) => {
  const record = await reader(expected.kind)(expected.spaceId);
  assert(
    record &&
      record.phase === expected.phase &&
      (await canonicalDigest(record)) === expected.sha256,
  );
  assert((await readAcceptedEntities(expected.spaceId)).length === 0);
  const summaries =
    expected.kind === "publication"
      ? await listPublicationSummaries()
      : await listPullSummaries();
  assert(summaries.length === 1 && summaries[0].phase === expected.phase);
  return {
    phase: record.phase,
    accepted: 0,
    ...(await globalThis.sampleSyncMemory()),
  };
};
