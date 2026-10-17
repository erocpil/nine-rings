import { importData, exportData } from "../src/lib/storage/db-export-import";
import { candidateEntities } from "../src/lib/sync/entity-projection";
import { canonicalDigest } from "../src/lib/sync/canonical-codec";
import { CURRENT_SYNC_CAPABILITIES } from "../src/lib/sync/protocol-capabilities";
import {
  addFrontendSettingsToBackup,
  withFrontendSettings,
} from "../src/lib/backup-user-settings";
import { parseSyncJson } from "../src/lib/sync/strict-json";

const { performance, TextEncoder } = globalThis;
const exportComplete = async () =>
  addFrontendSettingsToBackup(await exportData());

// The runner always creates a new, disposable browser context at a random origin.
globalThis.syncBrowserProbe = async (source) => {
  if (CURRENT_SYNC_CAPABILITIES.read || CURRENT_SYNC_CAPABILITIES.write)
    throw Error(
      "Storage probe requires production migration to remain disabled",
    );
  const stages = [];
  const stage = async (name, operation) => {
    const started = performance.now();
    const result = await operation();
    stages.push({
      name,
      ms: Math.round(performance.now() - started),
      ...(await globalThis.sampleSyncMemory()),
    });
    return result;
  };
  const before = await stage("source-projection", () =>
    candidateEntities(source, "web"),
  );
  await stage("product-import", async () => {
    const bundle = parseSyncJson(source);
    const settings = bundle.user_settings;
    let input = source;
    const legacyTemplates = settings?.values?.["nine-rings:templates"];
    if (bundle.templates === undefined && legacyTemplates !== undefined) {
      bundle.templates =
        typeof legacyTemplates === "string"
          ? parseSyncJson(legacyTemplates)
          : legacyTemplates;
      input = JSON.stringify(bundle);
    }
    if (settings?.values && bundle.templates !== undefined)
      delete settings.values["nine-rings:templates"];
    return withFrontendSettings(settings, () => importData(input, "replace"));
  });
  const exported = await stage("product-export", exportComplete);
  const after = await stage("export-projection", () =>
    candidateEntities(exported, "web"),
  );
  const previous = new Map(
    before.map((entity) => [JSON.stringify([entity.kind, entity.id]), entity]),
  );
  const changed = {};
  const added = {};
  for (const entity of after) {
    const key = JSON.stringify([entity.kind, entity.id]);
    if (!previous.has(key)) added[entity.kind] = (added[entity.kind] ?? 0) + 1;
    else if (previous.get(key).sha256 !== entity.sha256)
      changed[entity.kind] = (changed[entity.kind] ?? 0) + 1;
    previous.delete(key);
  }
  const missing = {};
  for (const entity of previous.values())
    missing[entity.kind] = (missing[entity.kind] ?? 0) + 1;
  return {
    sourceBytes: new TextEncoder().encode(source).length,
    exportedBytes: new TextEncoder().encode(exported).length,
    projectedCount: after.length,
    changed,
    added,
    missing,
    preserved: !Object.keys(changed).length && !Object.keys(missing).length,
    reloadDigest: await canonicalDigest(after),
    stages,
  };
};

globalThis.syncStorageReload = async (expected) => {
  const entities = await candidateEntities(await exportComplete(), "web");
  if ((await canonicalDigest(entities)) !== expected)
    throw Error("Storage changed across reload");
  return {
    projectedCount: entities.length,
    ...(await globalThis.sampleSyncMemory()),
  };
};
