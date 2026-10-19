import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import {
  buildReadingTextMap,
  createReadingAnnotation,
  quoteForRange,
  readingOffsetToPosition,
  readingPositionToOffset,
  reanchorReadingAnnotations,
} from "../src/lib/reading-annotations";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block" },
  text: { group: "inline" },
  hardBreak: { inline: true, group: "inline", atom: true },
} });
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("alpha beta")]),
  schema.node("paragraph", null, [schema.text("second line")]),
]);
const map = buildReadingTextMap(doc);
assert.equal(map.text, "alpha beta\nsecond line");
const betaFrom = 7;
const betaTo = 11;
assert.equal(readingPositionToOffset(map, betaFrom), 6);
assert.equal(readingOffsetToPosition(map, 6), betaFrom);
assert.deepEqual(quoteForRange(map, betaFrom, betaTo), { exact: "beta", prefix: "alpha ", suffix: "\nsecond line" });

const annotation = createReadingAnnotation("doc-1", doc, betaFrom, betaTo);
assert.equal(annotation.exact, "beta");
assert.equal(annotation.from, betaFrom);
assert.equal(annotation.to, betaTo);

const shifted = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("intro")]),
  schema.node("paragraph", null, [schema.text("alpha beta")]),
  schema.node("paragraph", null, [schema.text("second line")]),
]);
const shiftedResult = reanchorReadingAnnotations(shifted, [annotation]);
assert.equal(shiftedResult.removed.length, 0);
assert.equal(shifted.textBetween(shiftedResult.updates[0].from, shiftedResult.updates[0].to), "beta");
assert.ok(shiftedResult.updates[0].from > annotation.from);

const deleted = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("alpha ")])]);
assert.deepEqual(reanchorReadingAnnotations(deleted, [annotation]), { updates: [], removed: [annotation.id] });

const hardBreakDoc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("one"), schema.node("hardBreak"), schema.text("two")])]);
assert.equal(buildReadingTextMap(hardBreakDoc).text, "one\ntwo");

console.log("Reading annotation anchoring passed");
