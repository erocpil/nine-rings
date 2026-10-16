import { expect, it } from "vitest";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";

it("accepts an inferred legacy bullet boundary without rewriting source", () => {
  const body = {
    ops: [
      { insert: "First" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Second" },
      { insert: "\n", attributes: { list: "bullet" } },
    ],
  };
  const source = JSON.stringify(body);
  const restored = proseMirrorToDelta(deltaToProseMirror(body));
  expect(restored.ops[1].attributes?.["list-block-start"]).toBe(true);
  expect(isCertifiedStructuredBody(body)).toBe(true);
  expect(JSON.stringify(body)).toBe(source);
});
it("accepts inferred boundaries at nested list levels", () => {
  const body = {
    ops: [
      { insert: "Parent" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Child" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      { insert: "Next" },
      { insert: "\n", attributes: { list: "bullet" } },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
});
it("preserves an explicit boundary between otherwise adjacent lists", () => {
  const body = {
    ops: [
      { insert: "First" },
      {
        insert: "\n",
        attributes: { list: "bullet", "list-block-start": true },
      },
      { insert: "Separate" },
      {
        insert: "\n",
        attributes: { list: "bullet", "list-block-start": true },
      },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
  expect(deltaToProseMirror(body).content).toHaveLength(2);
});
it.each([
  { list: "bullet", listStart: 2 },
  { list: "ordered", listStart: 99 },
  { list: "bullet", indent: 7 },
  { list: "bullet", "list-block-start": false },
])("still rejects lossy or invalid legacy attributes %j", (attributes) => {
  const body = {
    ops: [
      { insert: "First" },
      { insert: "\n", attributes: { list: "ordered", listStart: 1 } },
      { insert: "Second" },
      { insert: "\n", attributes },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(false);
});
it("does not accept loss of newlines or formatting alongside a boundary", () => {
  const body = {
    ops: [
      { insert: "First\nSecond", attributes: { bold: true } },
      { insert: "\n", attributes: { list: "bullet" } },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(false);
});
