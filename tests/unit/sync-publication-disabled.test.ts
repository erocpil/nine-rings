import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { preparePublicationObjects } from "../../src/lib/sync/publication-objects";
import {
  persistPreparedAttempt,
  readPublicationAttempt,
} from "../../src/lib/sync/publication-store";
import { syncSpaceId } from "../../src/lib/sync/protocol-switch";
import { bytesDigest } from "../../src/lib/sync/remote-protocol";
afterEach(() => vi.unstubAllGlobals());
it("shipped zero capabilities refuse object creation before any Git request", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        run: () => Promise<unknown>,
      ) => run(),
    },
  });
  const source = JSON.stringify({ ...fixture, header: gates[1].bundle.header });
  const space = {
    owner: "example",
    repo: "disabled",
    branch: "main",
    path: "backup.json",
  };
  const spaceId = await syncSpaceId(space);
  await persistPreparedAttempt({
    version: 1,
    runtime: "web",
    id: "disabled-1",
    space,
    spaceId,
    expectedParent: "a".repeat(40),
    snapshotId: "example-001",
    snapshotSha256: await bytesDigest(source),
    source,
    control: "",
    localRevision: "b".repeat(64),
    storageGeneration: "headless",
    accepted: [],
    phase: "PREPARED",
    commitSha: null,
    updatedAt: new Date().toISOString(),
  });
  const request = vi.fn(),
    post = vi.fn();
  await expect(
    preparePublicationObjects({ spaceId, request, post }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect((await readPublicationAttempt(spaceId))?.phase).toBe("PREPARED");
});
