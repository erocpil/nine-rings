import {
  beginSyncProgress,
  endSyncProgress,
  readSyncProgress,
} from "../src/lib/sync/operation-progress";
import { api } from "../src/lib/api";
import {
  preflightProtocolFromGitHub,
  previewSyncDestinationFromGitHub,
  recoverPublicationFromGitHub,
} from "../src/lib/sync/github";
import {
  executeBootstrapPublication,
  executeIncrementalAction,
  verifyMigrationBackup,
  recoverIncrementalPull,
} from "../src/lib/sync/incremental-actions";
import { applyReviewedPull } from "../src/lib/sync/pull-application";
import {
  readAcceptedEntities,
  listPublicationSummaries,
} from "../src/lib/sync/publication-store";
import { listPullSummaries } from "../src/lib/sync/pull-store";
import { cancelUnpublishedPublication } from "../src/lib/sync/publication-recovery";
import { canonicalDigest } from "../src/lib/sync/canonical-codec";
import { CURRENT_SYNC_CAPABILITIES } from "../src/lib/sync/protocol-capabilities";
import { assertLegacyConnectionAllowed } from "../src/lib/sync/protocol-connection";

const flush = async () => {};
const assert = (value) => {
  if (!value) throw Error("Full sync rehearsal invariant failed");
};
let prepared = null;
async function review(config) {
  return previewSyncDestinationFromGitHub(config, await api.export.data());
}
globalThis.syncFlow = {
  async exportCurrent() { return api.export.data(); },
  progress() {
    return readSyncProgress();
  },
  async preflightReadOnly({ config }) {
    const owner = beginSyncProgress("实际远端只读核验");
    try {
      const report = await preflightProtocolFromGitHub(config);
      return {
        support: report.support,
        history: report.history,
        requests: report.reads.requests,
        bytes: report.reads.bytes,
        head: report.evidence.head,
        latest: report.evidence.snapshot.latestId,
      };
    } finally {
      endSyncProgress(owner);
    }
  },
  async reviewReadOnly({ config }) {
    const owner = beginSyncProgress("完整本机与实际远端候选比较");
    try {
      const value = await review(config);
      const counts = {};
      if ("kind" in value)
        return { bootstrap: true, entities: value.entityCount };
      for (const row of value.rows)
        counts[row.difference] = (counts[row.difference] ?? 0) + 1;
      return {
        bootstrap: false,
        rows: value.rows.length,
        timings: value.timings,
        differences: counts,
        expiredDraft: value.expiredDraft,
      };
    } finally {
      endSyncProgress(owner);
    }
  },
  async init({ fixture }) {
    assert(
      CURRENT_SYNC_CAPABILITIES.write === 1 &&
        CURRENT_SYNC_CAPABILITIES.read === 1,
    );
    await api.export.import(JSON.stringify(fixture), "replace");
    return { documents: (await api.notes.all()).length };
  },
  async edit({ id, title }) {
    await api.notes.update(id, { title });
  },
  async prepare({ config, id }) {
    const value = await review(config);
    const choices =
      "kind" in value
        ? []
        : value.rows
            .filter((row) => row.kind === "note" && row.id === id)
            .map((row) => ({
              key: row.key,
              localHash: row.localHash,
              remoteHash: row.remoteHash,
              action: "local",
            }));
    prepared = {
      config,
      review: value,
      choices,
      backup: await verifyMigrationBackup(value, await api.export.data()),
      participants: { confirmed: true, minimumVersion: "0.3.0" },
      migrationConfirmed: true,
    };
    return {
      bootstrap: "kind" in value,
      spaceId:
        value.kind === "bootstrap" ? value.report.spaceId : value.spaceId,
    };
  },
  async publish() {
    assert(prepared);
    return "kind" in prepared.review
      ? executeBootstrapPublication(prepared, { flush })
      : executeIncrementalAction({ ...prepared, action: "publish" }, { flush });
  },
  async equal({ config }) {
    const value = await review(config);
    assert(!("kind" in value));
    await executeIncrementalAction(
      { config, review: value, choices: [], action: "equal" },
      { flush },
    );
  },
  async pull({ config, id, loseConfirmation = false }) {
    const value = await review(config);
    assert(!("kind" in value));
    const row = value.rows.find((row) => row.kind === "note" && row.id === id);
    assert(row);
    const choices = [
      {
        key: row.key,
        localHash: row.localHash,
        remoteHash: row.remoteHash,
        action: "remote",
      },
    ];
    if (loseConfirmation) {
      const { incrementalTransport } =
        await import("../src/lib/sync/incremental-actions");
      try {
        await applyReviewedPull(
          { review: value, choices },
          {
            flush,
            readSource: () => api.export.data(),
            request: incrementalTransport(config, value.space).request,
            apply: async (source, context) => {
              await api.export.import(source, "merge", context);
              throw Error("injected confirmation loss");
            },
          },
        );
        throw Error("injected failure was not observed");
      } catch (error) {
        assert(error.message.includes("injected confirmation loss"));
      }
    } else
      await executeIncrementalAction(
        { config, review: value, choices, action: "pull" },
        { flush },
      );
    return {
      conflict: row.difference === "conflict",
      spaceId: value.spaceId,
      documentDigest: await canonicalDigest(await api.notes.get(id)),
    };
  },
  async recoverPublication({ config, spaceId }) {
    return recoverPublicationFromGitHub(config, spaceId);
  },
  async recoverPull({ config, spaceId }) {
    return recoverIncrementalPull(config, spaceId, flush);
  },
  async checkDocument({ id, title, digest }) {
    const note = await api.notes.get(id);
    assert(note && note.title === title);
    if (digest) assert((await canonicalDigest(note)) === digest);
  },
  async inspect({ spaceId }) {
    return {
      publication:
        (await listPublicationSummaries()).find(
          (row) => row.spaceId === spaceId,
        )?.phase ?? null,
      pull:
        (await listPullSummaries()).find((row) => row.spaceId === spaceId)
          ?.phase ?? null,
      accepted: (await readAcceptedEntities(spaceId)).length,
    };
  },
  async cancel({ spaceId }) {
    const row = (await listPublicationSummaries()).find(
      (row) => row.spaceId === spaceId,
    );
    assert(row);
    await cancelUnpublishedPublication(spaceId, row.id);
  },
  async legacyBlocked({ config }) {
    let blocked = false;
    try {
      await assertLegacyConnectionAllowed(config, globalThis.localStorage);
    } catch {
      blocked = true;
    }
    assert(blocked);
  },
};
