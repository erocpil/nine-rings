import { expect, it } from "vitest";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
import fixture from "../../schema/sync/fixtures/candidate-footnotes-v1.json";

it.each(["footnoteNumber", "footnoteOccurrence", "both"])(
  "certifies only omitted %s against full-document numbering and real definitions",
  (field) => {
    const body = structuredClone(fixture.notes[0].content);
    for (const op of body.ops) {
      if (!op.attributes || !("footnoteRef" in op.attributes)) continue;
      const attrs = op.attributes as Record<string, unknown>;
      if (field === "both" || field === "footnoteNumber")
        delete attrs.footnoteNumber;
      if (field === "both" || field === "footnoteOccurrence")
        delete attrs.footnoteOccurrence;
    }
    const source = JSON.stringify(body);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    const saved = proseMirrorToDelta(deltaToProseMirror(body));
    expect(candidateBodyProjection(saved)).toEqual(
      candidateBodyProjection(fixture.notes[0].content),
    );
    expect(JSON.stringify(body)).toBe(source);
  },
);
type MutableBody = {
  ops: { insert: unknown; attributes?: Record<string, unknown> }[];
};
const reference = (body: MutableBody) =>
  body.ops.find((op) => op.attributes?.footnoteRef)!;
const isDefinitions = (op: MutableBody["ops"][number]) =>
  !!op.insert && typeof op.insert === "object" && "footnotes" in op.insert;
it("never rewrites stale labels, counters, definitions or missing definitions", () => {
  for (const mutate of [
    (body: MutableBody) => {
      reference(body).insert = "2";
    },
    (body: MutableBody) => {
      reference(body).attributes!.footnoteOccurrence = 9;
    },
    (body: MutableBody) => {
      body.ops = body.ops.filter((op) => !isDefinitions(op));
    },
    (body: MutableBody) => {
      const definitions = body.ops.find(isDefinitions)!.insert as {
        footnotes: { references: number }[];
      };
      definitions.footnotes[0].references = 9;
    },
  ]) {
    const body: MutableBody = structuredClone(fixture.notes[0].content);
    for (const op of body.ops)
      if (op.attributes?.footnoteRef) delete op.attributes.footnoteNumber;
    mutate(body);
    expect(isCertifiedStructuredBody(body)).toBe(false);
  }
});
