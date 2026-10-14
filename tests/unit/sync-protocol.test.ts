import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import vectors from "../../schema/sync/fixtures/canonical-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import {
  canonicalJson,
  canonicalDigest,
} from "../../src/lib/sync/canonical-codec";
import {
  assertSyncCapabilities,
  type SyncCapabilities,
} from "../../src/lib/sync/protocol-capabilities";
import { validateBackup } from "../../src/lib/backup-validation";

it.each(vectors.vectors)(
  "frozen codec vector: $name",
  async ({ input, canonical, sha256 }) => {
    expect(canonicalJson(input)).toBe(canonical);
    expect(await canonicalDigest(input)).toBe(sha256);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(sha256);
  },
);
it("ignores object insertion order but preserves arrays, unicode, unknown fields and ciphertext", async () => {
  expect(await canonicalDigest({ b: 1, a: 2 })).toBe(
    await canonicalDigest({ a: 2, b: 1 }),
  );
  for (const [a, b] of [
    [
      [1, 2],
      [2, 1],
    ],
    ["é", "e\u0301"],
    ["a\n", "a\r\n"],
    [{ future: 1 }, {}],
    [{ ciphertext: "a" }, { ciphertext: "b" }],
  ])
    expect(await canonicalDigest(a)).not.toBe(await canonicalDigest(b));
});
it.each([
  NaN,
  Infinity,
  -Infinity,
  9007199254740992,
  undefined,
  BigInt(1),
  () => 1,
  new Date(),
  new Map(),
  new Array(2),
  { a: undefined },
])("refuses non-JSON/unsafe numeric input without silent coercion", (value) => {
  expect(() => canonicalJson(value)).toThrow("受支持的 JSON");
});
it("rejects cycles, accessors, decorated arrays and excessive nesting; allows shared non-cyclic values", () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  const getter = {
    get secret() {
      throw Error("PRIVATE_VALUE");
    },
  };
  expect(() => canonicalJson(cycle)).toThrow();
  expect(() => canonicalJson(getter)).toThrow("受支持的 JSON");
  expect(() => canonicalJson(Object.assign([], { extra: 1 }))).toThrow();
  let deep: unknown = null;
  for (let i = 0; i < 102; i++) deep = [deep];
  expect(() => canonicalJson(deep)).toThrow();
  const shared = { a: 1 };
  expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
});
it.each(gates)("production import gate: $name", ({ bundle, allowed }) => {
  if (allowed) expect(() => validateBackup(bundle)).not.toThrow();
  else expect(() => validateBackup(bundle)).toThrow("同步协议");
});
const certified: SyncCapabilities = {
  formats: [1],
  codecs: [1],
  read: 1,
  write: 1,
  readFeatures: [],
  writeFeatures: [],
};
const envelope = () => JSON.parse(JSON.stringify(gates[1].bundle));
it("separates read/write feature requirements and never treats unknown requirements as optional", () => {
  const input = envelope();
  input.header.requires.writeFeatures = ["future-write"];
  expect(
    assertSyncCapabilities(input, {
      operation: "read",
      capabilities: certified,
    }),
  ).toBe("envelope");
  expect(() =>
    assertSyncCapabilities(input, {
      operation: "write",
      capabilities: certified,
    }),
  ).toThrow("尚不支持");
  input.header.requires.readFeatures = ["future-read"];
  expect(() =>
    assertSyncCapabilities(input, {
      operation: "read",
      capabilities: certified,
    }),
  ).toThrow("尚不支持");
});
it("binds identity, rejects malformed/missing headers and leaves unknown extension fields unchanged", () => {
  const input = envelope();
  input.header.extension = { keep: "PRIVATE_VALUE" };
  const before = JSON.stringify(input);
  expect(
    assertSyncCapabilities(input, {
      operation: "write",
      expectedId: "example-001",
      capabilities: certified,
    }),
  ).toBe("envelope");
  expect(JSON.stringify(input)).toBe(before);
  expect(() =>
    assertSyncCapabilities(input, {
      operation: "read",
      expectedId: "other",
      capabilities: certified,
    }),
  ).toThrow("身份");
  expect(() =>
    assertSyncCapabilities({}, { operation: "read", requireHeader: true }),
  ).toThrow("不能自动降级");
  for (const changes of [
    { codec: 2 },
    { format: 2 },
    { requires: { read: 2, write: 1, readFeatures: [], writeFeatures: [] } },
  ])
    expect(() =>
      assertSyncCapabilities(
        { ...input, header: { ...input.header, ...changes } },
        { operation: "read", capabilities: certified },
      ),
    ).toThrow("尚不支持");
  input.header.requires.readFeatures = ["same", "same"];
  expect(() =>
    assertSyncCapabilities(input, {
      operation: "read",
      capabilities: certified,
    }),
  ).toThrow("协议头无效");
});

it("candidate schema and runtime both validate the envelope while preserving extensions", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: schema } =
    await import("../../schema/sync/envelope-candidate-v1.schema.json");
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  const input = envelope();
  input.header.future = { retain: true };
  input.futureBundle = { retain: true };
  expect(validate(input)).toBe(true);
  expect(
    assertSyncCapabilities(input, {
      operation: "read",
      capabilities: certified,
    }),
  ).toBe("envelope");
  for (const invalid of [
    "../escape",
    "/absolute",
    "bad/id",
    " ",
    "x".repeat(129),
  ]) {
    const candidate = envelope();
    candidate.header.id = invalid;
    expect(validate(candidate)).toBe(false);
    expect(() =>
      assertSyncCapabilities(candidate, {
        operation: "read",
        capabilities: certified,
      }),
    ).toThrow("协议头无效");
  }
  for (const date of [
    "2026-02-30T00:00:00Z",
    "2026-10-14T24:00:00Z",
    "2026-10-14",
    "2026-02-29T00:00:00Z",
  ]) {
    const candidate = envelope();
    candidate.header.createdAt = date;
    expect(() =>
      assertSyncCapabilities(candidate, {
        operation: "read",
        capabilities: certified,
      }),
    ).toThrow("协议头无效");
  }
  for (const date of [
    "2024-02-29T12:00:00Z",
    "2026-10-14T12:34:56.123456+08:00",
  ]) {
    const candidate = envelope();
    candidate.header.createdAt = date;
    expect(validate(candidate)).toBe(true);
    expect(() =>
      assertSyncCapabilities(candidate, {
        operation: "read",
        capabilities: certified,
      }),
    ).not.toThrow();
  }
});
