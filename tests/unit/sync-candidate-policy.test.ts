import { expect, it } from "vitest";
import fixture from "../../schema/sync/fixtures/storage-roundtrip.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import {
  reviewCandidatePayload,
  assertCandidateWrite,
} from "../../src/lib/sync/candidate-write-policy";
import {
  createDocumentKey,
  encryptDocument,
  decryptDocument,
  isEncrypted,
} from "../../src/lib/document-crypto";
import type { SyncCapabilities } from "../../src/lib/sync/protocol-capabilities";

function bundle() {
  // Deliberately untyped JSON mutations model untrusted incoming data.
  const value = JSON.parse(JSON.stringify(fixture));
  delete value.futureBundle;
  delete value.notes[0].futureRecord;
  delete value.templates[0].futureTemplate;
  value.notes[0].content = { ops: [{ insert: "PRIVATE_BODY\n" }] };
  return value;
}
const review = (value: unknown, runtime: "web" | "tauri" | "flutter" = "web") =>
  reviewCandidatePayload(JSON.stringify(value), runtime);
const capabilities: SyncCapabilities = {
  formats: [1],
  codecs: [1],
  read: 1,
  write: 1,
  readFeatures: ["text-document-v1", "template-metadata-v1"],
  writeFeatures: ["text-document-v1", "template-metadata-v1"],
};
it("checks a narrow candidate without changing source; production never grants write capability", () => {
  const value = bundle();
  const before = JSON.stringify(value);
  expect(review(value)).toMatchObject({
    eligible: true,
    counts: { documents: 1, templates: 1 },
  });
  value.header = JSON.parse(JSON.stringify(gates[1].bundle.header));
  const source = JSON.stringify(value);
  expect(() =>
    assertCandidateWrite(source, { runtime: "web", expectedId: "example-001" }),
  ).toThrow();
  expect(() =>
    assertCandidateWrite(source, {
      runtime: "web",
      expectedId: "example-001",
      capabilities,
    }),
  ).toThrow("未完整声明");
  value.header.requires.readFeatures = capabilities.readFeatures;
  value.header.requires.writeFeatures = capabilities.writeFeatures;
  expect(
    assertCandidateWrite(JSON.stringify(value), {
      runtime: "web",
      expectedId: "example-001",
      capabilities,
    }).eligible,
  ).toBe(true);
  delete value.header;
  expect(JSON.stringify(value)).toBe(before);
});
it.each(["root", "note", "template", "body", "attribute"])(
  "refuses unknown %s data without echoing or stripping private content",
  (target) => {
    const value = bundle();
    const objects = {
      root: value,
      note: value.notes[0],
      template: value.templates[0],
      body: value.notes[0].content,
      attribute: (value.notes[0].content.ops[0].attributes = {}),
    };
    objects[target as keyof typeof objects].PRIVATE_EXTENSION = "PRIVATE_VALUE";
    const before = JSON.stringify(value);
    const result = review(value);
    expect(result.eligible).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE/);
    expect(JSON.stringify(value)).toBe(before);
  },
);
it.each([
  "same-alias",
  "different-alias",
  "numeric-boolean",
  "noncanonical-path",
  "deleted",
  "embed",
  "prosemirror",
])("refuses lossy normalization: %s", (kind) => {
  const value = bundle(),
    note = value.notes[0];
  if (kind === "same-alias") note.storagePath = note.storage_path;
  if (kind === "different-alias") note.storagePath = "ideas";
  if (kind === "numeric-boolean") note.pinned = 1;
  if (kind === "noncanonical-path") note.storage_path = "/ideas/";
  if (kind === "deleted") note.deleted_at = "2026-10-15";
  if (kind === "embed") note.content.ops[0].insert = { image: "private" };
  if (kind === "prosemirror") note.content = { type: "doc", content: [] };
  expect(review(value).eligible).toBe(false);
});
it("rejects duplicate raw keys and stringified body duplicates before normalization", () => {
  expect(
    reviewCandidatePayload('{"version":1,"notes":[],"notes":[]}', "web")
      .eligible,
  ).toBe(false);
  const value = bundle();
  value.notes[0].content = '{"ops":[],"ops":[]}';
  expect(review(value).eligible).toBe(false);
});
it("probes settings in isolated memory and refuses credentials, foreign baselines and duplicate template stores", () => {
  const value = bundle();
  value.user_settings = {
    version: 1,
    values: {
      "nr:github-sync": { owner: "example", repo: "backup", path: "latest" },
      "nr:focusMode": true,
    },
  };
  expect(review(value).eligible).toBe(true);
  for (const key of [
    "token",
    "lastPushVersion",
    "remoteSha",
    "protocolEnabled",
  ]) {
    const copy = structuredClone(value);
    copy.user_settings.values["nr:github-sync"][key] = "PRIVATE";
    expect(review(copy).issues["settings-loss"]).toBe(1);
  }
  for (const key of [
    "unknown",
    "nr:sync-protocol:v1:fact",
    "scrollPos:inactive",
  ]) {
    const copy = structuredClone(value);
    copy.user_settings.values[key] = "PRIVATE";
    expect(review(copy).eligible).toBe(false);
  }
  value.user_settings.values["nine-rings:templates"] = [];
  expect(review(value).issues["duplicate-template-source"]).toBe(1);
  delete value.user_settings;
  value.config = {};
  expect(review(value).issues["settings-not-certified"]).toBe(1);
});
it("keeps Flutter uncertified for templates, settings, protected data and version 2", () => {
  const value = bundle();
  expect(review(value, "flutter").issues["runtime-unsupported"]).toBeTruthy();
  delete value.templates;
  expect(review(value, "flutter").eligible).toBe(true);
  value.version = 2;
  expect(review(value, "flutter").eligible).toBe(false);
});
it("preserves real ciphertext and refuses protection/history inconsistencies or leaked search text", async () => {
  const value = bundle(),
    note = value.notes[0];
  const key = await createDocumentKey("test-password");
  const original = { ops: [{ insert: "PRIVATE_ENCRYPTED\n" }] };
  const sealed = await encryptDocument(original, key);
  note.content = sealed;
  note.search_text = "";
  value.protected_paths = [
    {
      id: key.protectionId,
      path: "references",
      verifier: sealed,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    },
  ];
  value.protected_versions = [
    {
      id: "history-1",
      note_id: note.id,
      title: note.title,
      content: sealed,
      tags: [],
      pinned: false,
      sort_order: 0,
      saved_at: note.updated_at,
    },
  ];
  const source = JSON.stringify(value);
  expect(review(value).eligible).toBe(true);
  expect(JSON.stringify(value)).toBe(source);
  expect(
    await decryptDocument(JSON.parse(source).notes[0].content, key),
  ).toEqual(original);
  for (const mutation of [
    "plaintext",
    "search",
    "orphan",
    "different-key",
    "different-salt",
    "history-type",
    "unknown-crypto",
  ]) {
    const copy = JSON.parse(source);
    if (mutation === "plaintext") copy.notes[0].content = original;
    if (mutation === "search") copy.notes[0].search_text = "PRIVATE_ENCRYPTED";
    if (mutation === "orphan") copy.protected_versions[0].note_id = "missing";
    if (mutation === "different-key")
      copy.protected_versions[0].content.encrypted.protectionId = "other";
    if (mutation === "different-salt")
      copy.protected_versions[0].content.encrypted.salt =
        btoa("0123456789abcdef");
    if (mutation === "history-type") copy.protected_versions[0].pinned = 1;
    if (mutation === "unknown-crypto")
      copy.notes[0].content.encrypted.future = "PRIVATE";
    expect(review(copy).eligible, mutation).toBe(false);
  }
  expect(isEncrypted(sealed)).toBe(true);
});
