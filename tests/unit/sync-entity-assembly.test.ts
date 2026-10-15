import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { candidateEntities } from "../../src/lib/sync/entity-projection";
import { entityKey, type EntityChoice } from "../../src/lib/sync/entity-plan";
const source = JSON.stringify(fixture);
const input = {
  spaceId: "a".repeat(64),
  localSource: source,
  remoteSource: source,
  runtime: "web" as const,
  baselines: [],
};
async function choices(
  localSource: string,
  keys: string[],
): Promise<EntityChoice[]> {
  const local = await candidateEntities(localSource, "web");
  const remote = await candidateEntities(source, "web");
  return local
    .filter((e) => keys.includes(e.kind))
    .map((e) => ({
      key: entityKey(e),
      localHash: e.sha256,
      remoteHash:
        remote.find((r) => entityKey(r) === entityKey(e))?.sha256 ?? null,
      action: "local",
    }));
}
it("assembles only selected raw sources without copying snapshot provenance", async () => {
  const local = structuredClone(fixture);
  local.notes[0].title = "local";
  local.templates[0].name = "ignored";
  const localSource = JSON.stringify(local);
  const result = await assembleEntityCandidate({
    ...input,
    localSource,
    choices: await choices(localSource, ["note"]),
  });
  const payload = JSON.parse(result.source);
  expect(
    payload.notes.find((n: { id: string }) => n.id === local.notes[0].id).title,
  ).toBe("local");
  expect(payload.templates).toEqual(fixture.templates);
  expect(payload).not.toHaveProperty("exported_at");
  expect(payload).not.toHaveProperty("header");
  expect(result.writable).toBe(false);
  expect(result.publicationNeeded).toBe(true);
  expect(result.afterPublication).toHaveLength(1);
  expect(result.afterLocalApply).toEqual([]);
  expect(local.templates[0].name).toBe("ignored");
});
it("validates cross-entity protection after combining individually valid sources", async () => {
  const localSource = source.replaceAll(
    "z3jf5bgo98iwlc7YHuXgmw==",
    "a3jf5bgo98iwlc7YHuXgmw==",
  );
  await expect(
    assembleEntityCandidate({
      ...input,
      localSource,
      choices: await choices(localSource, ["note"]),
    }),
  ).rejects.toThrow("保护关系");
  await expect(
    assembleEntityCandidate({
      ...input,
      localSource,
      choices: await choices(localSource, ["note", "protected-path"]),
    }),
  ).rejects.toThrow("保护关系");
  const complete = await assembleEntityCandidate({
    ...input,
    localSource,
    choices: await choices(localSource, [
      "note",
      "protected-path",
      "protected-version",
    ]),
  });
  expect(complete.review.eligible).toBe(true);
  expect(complete.afterPublication).toHaveLength(3);
});
it("binds ignores and explicit acceptance even when candidate bytes are equal", async () => {
  const equal = await assembleEntityCandidate(input);
  const entity = (await candidateEntities(source, "web"))[0];
  const ignored = await assembleEntityCandidate({
    ...input,
    choices: [
      {
        key: entityKey(entity),
        localHash: entity.sha256,
        remoteHash: entity.sha256,
        action: "ignore",
      },
    ],
  });
  expect(ignored.source).toBe(equal.source);
  expect(ignored.planSha256).not.toBe(equal.planSha256);
  expect(ignored.publicationNeeded).toBe(false);
  expect(ignored.equal).toHaveLength(equal.equal.length - 1);
  expect((await assembleEntityCandidate(input)).planSha256).toBe(
    equal.planSha256,
  );
});
it("rejects stale choices and uncertified settings instead of silently dropping them", async () => {
  const local = structuredClone(fixture);
  local.notes[0].title = "updated";
  const stale = await choices(source, ["note"]);
  await expect(
    assembleEntityCandidate({
      ...input,
      localSource: JSON.stringify(local),
      choices: stale,
    }),
  ).rejects.toThrow("已变化");
  await expect(
    assembleEntityCandidate({
      ...input,
      localSource: JSON.stringify({ ...fixture, config: { unknown: true } }),
    }),
  ).rejects.toThrow();
});

it("assembled candidate survives actual IDB import/export within the certified scope", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  try {
    const local = structuredClone(fixture);
    local.notes[0].title = "assembled title";
    const localSource = JSON.stringify(local);
    const result = await assembleEntityCandidate({
      ...input,
      localSource,
      choices: await choices(localSource, ["note"]),
    });
    await importData(result.source, "replace");
    const { version, notes, templates, protected_paths, protected_versions } =
      JSON.parse(await exportData());
    // AppConfig and local settings added by export are not part of this certified fixture.
    const scoped = JSON.stringify({
      version,
      notes,
      templates,
      protected_paths,
      protected_versions,
    });
    expect(await candidateEntities(scoped, "web")).toEqual(
      await candidateEntities(result.source, "web"),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
