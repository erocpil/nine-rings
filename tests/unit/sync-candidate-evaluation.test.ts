import { expect, it } from "vitest";
import entities from "../../schema/sync/fixtures/candidate-entities-v1.json";
import blocks from "../../schema/sync/fixtures/candidate-structured-block-v1.json";
import footnotes from "../../schema/sync/fixtures/candidate-footnotes-v1.json";
import html from "../../schema/sync/fixtures/candidate-html-v1.json";
import tables from "../../schema/sync/fixtures/candidate-table-v1.json";
import special from "../../schema/sync/fixtures/candidate-special-blocks-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import {
  reviewCandidatePayload,
  assertCandidateWrite,
  createCandidateEvaluationScope,
  inspectCandidateEvaluation,
  disposeCandidateEvaluationScope,
  withCandidateEvaluation,
  type CandidateEvaluationScope,
} from "../../src/lib/sync/candidate-write-policy";

for (const runtime of ["web", "tauri", "flutter"] as const) {
  it.each([entities, blocks, footnotes, html, tables, special])(
    `${runtime}: cached bodies preserve diagnostics/features/counts regardless of order`,
    (fixture) => {
      const scope = createCandidateEvaluationScope();
      try {
        const source = JSON.stringify(fixture);
        const uncached = reviewCandidatePayload(source, runtime);
        expect(reviewCandidatePayload(source, runtime, scope)).toEqual(
          uncached,
        );
        const before = inspectCandidateEvaluation(scope);
        expect(reviewCandidatePayload(source, runtime, scope)).toEqual(
          uncached,
        );
        expect(inspectCandidateEvaluation(scope).hits).toBeGreaterThan(
          before.hits,
        );
        const reordered = JSON.stringify({
          ...fixture,
          notes: [...fixture.notes].reverse(),
        });
        expect(reviewCandidatePayload(reordered, runtime, scope)).toEqual(
          reviewCandidatePayload(reordered, runtime),
        );
      } finally {
        disposeCandidateEvaluationScope(scope);
      }
    },
  );
}
const oneNote = (text = "example\n") => ({
  version: 2,
  notes: [{ ...entities.notes[0], content: { ops: [{ insert: text }] } }],
  templates: [],
});
it("new body bytes and unknown metadata cannot borrow earlier certification", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const original = oneNote();
    expect(
      reviewCandidatePayload(JSON.stringify(original), "web", scope).eligible,
    ).toBe(true);
    for (const content of [
      { ops: [{ insert: "unterminated" }] },
      { ops: [{ insert: "example\n" }], metadata: { unknown: true } },
      { ops: [{ insert: "example\n", attributes: { future: true } }] },
    ]) {
      const changed = JSON.stringify({
        ...original,
        notes: [{ ...original.notes[0], content }],
      });
      const expected = reviewCandidatePayload(changed, "web");
      expect(expected.eligible).toBe(false);
      expect(reviewCandidatePayload(changed, "web", scope)).toEqual(expected);
      expect(reviewCandidatePayload(changed, "web", scope)).toEqual(expected);
    }
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("root metadata and protection relationships are checked afresh after body cache hits", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const source = JSON.stringify(entities);
    expect(reviewCandidatePayload(source, "web", scope).eligible).toBe(true);
    const unknown = JSON.stringify({ ...entities, future: true });
    expect(reviewCandidatePayload(unknown, "web", scope)).toEqual(
      reviewCandidatePayload(unknown, "web"),
    );
    expect(
      reviewCandidatePayload(unknown, "web", scope).issues["unknown-metadata"],
    ).toBeGreaterThan(0);
    const changed = structuredClone(entities);
    changed.protected_versions[0].note_id = changed.notes[0].id;
    expect(
      reviewCandidatePayload(JSON.stringify(changed), "web", scope).issues[
        "protection-mismatch"
      ],
    ).toBeGreaterThan(0);
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("warm certification does not override omitted feature declarations", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const source = JSON.stringify({
      ...oneNote(),
      header: gates[1].bundle.header,
    });
    const review = reviewCandidatePayload(source, "web", scope);
    expect(review.eligible).toBe(true);
    expect(() =>
      assertCandidateWrite(
        source,
        { runtime: "web", expectedId: "example-001" },
        scope,
      ),
    ).toThrow("必需特性");
    expect(() =>
      assertCandidateWrite(
        source,
        {
          runtime: "web",
          expectedId: "example-001",
          capabilities: {
            formats: [1],
            codecs: [1],
            read: 1,
            write: 1,
            readFeatures: review.requiredFeatures,
            writeFeatures: review.requiredFeatures,
          },
        },
        scope,
      ),
    ).toThrow("必需特性");
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("callers cannot poison verdicts, counterfeit scopes, or reuse disposed scopes", () => {
  const source = JSON.stringify(oneNote());
  const scope = createCandidateEvaluationScope();
  const first = reviewCandidatePayload(source, "web", scope);
  first.requiredFeatures.length = 0;
  first.eligible = false;
  expect(reviewCandidatePayload(source, "web", scope)).toEqual(
    reviewCandidatePayload(source, "web"),
  );
  expect(() =>
    reviewCandidatePayload(source, "web", structuredClone(scope)),
  ).toThrow("上下文");
  disposeCandidateEvaluationScope(scope);
  expect(inspectCandidateEvaluation(scope)).toMatchObject({
    entries: 0,
    bytes: 0,
    closed: true,
  });
  expect(() => reviewCandidatePayload(source, "web", scope)).toThrow("上下文");
});
it("LRU and byte limits evict rather than skip certification", () => {
  const scope = createCandidateEvaluationScope({
    maxEntries: 1,
    maxBytes: 2048,
  });
  try {
    for (const text of ["a\n", "b\n", "a\n", "x".repeat(3000) + "\n"]) {
      const source = JSON.stringify(oneNote(text));
      expect(reviewCandidatePayload(source, "web", scope)).toEqual(
        reviewCandidatePayload(source, "web"),
      );
      const stats = inspectCandidateEvaluation(scope);
      expect(stats.entries).toBeLessThanOrEqual(1);
      expect(stats.bytes).toBeLessThanOrEqual(2048);
    }
    expect(inspectCandidateEvaluation(scope)).toMatchObject({
      hits: 0,
      misses: 4,
    });
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
  for (const options of [
    { maxBytes: -1 },
    { maxBytes: Infinity },
    { maxEntries: 513 },
  ])
    expect(() => createCandidateEvaluationScope(options)).toThrow("预算");
});
it.each([false, true])(
  "owned scopes release all keys after success or failure=%s",
  async (fail) => {
    let captured: CandidateEvaluationScope | undefined;
    const action = withCandidateEvaluation(undefined, async (scope) => {
      captured = scope;
      reviewCandidatePayload(JSON.stringify(oneNote()), "web", scope);
      expect(inspectCandidateEvaluation(scope).bytes).toBeGreaterThan(0);
      if (fail) throw Error("cancelled");
      return true;
    });
    if (fail) await expect(action).rejects.toThrow("cancelled");
    else await expect(action).resolves.toBe(true);
    expect(inspectCandidateEvaluation(captured!)).toMatchObject({
      closed: true,
      entries: 0,
      bytes: 0,
    });
  },
);
it("a Web verdict cannot certify the same body for Flutter", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const source = JSON.stringify(blocks);
    expect(reviewCandidatePayload(source, "web", scope).eligible).toBe(true);
    const expected = reviewCandidatePayload(source, "flutter");
    expect(expected.eligible).toBe(false);
    expect(reviewCandidatePayload(source, "flutter", scope)).toEqual(expected);
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("byte capacity independently evicts old bodies and revalidates them", () => {
  const probe = createCandidateEvaluationScope();
  reviewCandidatePayload(JSON.stringify(oneNote("aa\n")), "web", probe);
  const bytes = inspectCandidateEvaluation(probe).bytes;
  disposeCandidateEvaluationScope(probe);
  expect(bytes).toBeGreaterThan(0);
  const scope = createCandidateEvaluationScope({ maxBytes: bytes + 10 });
  try {
    for (const text of ["aa\n", "bb\n", "aa\n"]) {
      const source = JSON.stringify(oneNote(text));
      expect(reviewCandidatePayload(source, "web", scope)).toEqual(
        reviewCandidatePayload(source, "web"),
      );
    }
    expect(inspectCandidateEvaluation(scope)).toMatchObject({
      entries: 1,
      misses: 3,
      hits: 0,
    });
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("string bodies stay strict-decoded even after a successful cache hit", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const fixture = oneNote();
    const body = JSON.stringify(fixture.notes[0].content);
    const source = JSON.stringify({
      ...fixture,
      notes: [{ ...fixture.notes[0], content: body }],
    });
    expect(reviewCandidatePayload(source, "web", scope)).toEqual(
      reviewCandidatePayload(source, "web"),
    );
    expect(reviewCandidatePayload(source, "web", scope).eligible).toBe(true);
    expect(inspectCandidateEvaluation(scope).hits).toBeGreaterThan(0);
    const duplicate = JSON.stringify({
      ...fixture,
      notes: [
        {
          ...fixture.notes[0],
          content: '{"ops":[],"ops":[{"insert":"ok\\n"}]}',
        },
      ],
    });
    expect(reviewCandidatePayload(duplicate, "web", scope)).toEqual(
      reviewCandidatePayload(duplicate, "web"),
    );
    expect(reviewCandidatePayload(duplicate, "web", scope).eligible).toBe(
      false,
    );
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
it("throwing content validation preserves diagnostics accumulated outside that body", () => {
  const scope = createCandidateEvaluationScope();
  try {
    const source = JSON.stringify({
      ...oneNote(),
      future: true,
      notes: [
        {
          ...oneNote().notes[0],
          content: { ops: [], encrypted: { version: 999 } },
        },
      ],
    });
    const expected = reviewCandidatePayload(source, "web");
    expect(expected.eligible).toBe(false);
    expect(reviewCandidatePayload(source, "web", scope)).toEqual(expected);
    expect(reviewCandidatePayload(source, "web", scope)).toEqual(expected);
  } finally {
    disposeCandidateEvaluationScope(scope);
  }
});
