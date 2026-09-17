import { beforeEach, expect, test } from "vitest";
import {
  clearReadingBlockSessions,
  readingBlockSession,
} from "../../src/lib/reading-block-session";

beforeEach(clearReadingBlockSessions);

test("block display state survives remounts but is isolated by document and revision", () => {
  const first = readingBlockSession("a", "1");
  first.set(12, { collapsed: true });
  expect(readingBlockSession("a", "1")).toBe(first);
  expect(readingBlockSession("b", "1").has(12)).toBe(false);
  expect(readingBlockSession("a", "2").has(12)).toBe(false);
});

test("clearing protected-document caches discards display state", () => {
  readingBlockSession("a", "1").set(12, { collapsed: true });
  clearReadingBlockSessions();
  expect(readingBlockSession("a", "1").size).toBe(0);
});
