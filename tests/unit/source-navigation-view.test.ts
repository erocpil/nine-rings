import { describe, expect, it } from "vitest";
import {
  outlineVisibleEntries,
  sourceOutlineItems,
} from "../../src/lib/source-navigation-view";
import type { DocumentOutlineItem } from "../../src/lib/document-outline";

describe("shared navigation projections", () => {
  it("folds descendants without losing original indexes or unrelated siblings", () => {
    const items: DocumentOutlineItem[] = [1, 2, 3, 2, 1].map((level, pos) => ({
      level,
      pos,
      text: String(pos),
    }));
    const entries = outlineVisibleEntries(items, (item) => item.pos === 1);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 3, 4]);
    expect(entries[1]).toMatchObject({ folded: true, foldable: true });
    expect(entries.at(-1)).toMatchObject({ folded: false, foldable: false });
    expect(items).toHaveLength(5);
  });

  it("supports source nesting beyond Markdown's six heading levels", () => {
    const items = [1, 7, 8, 9, 7, 1].map((level, pos) => ({
      level,
      pos,
      text: String(pos),
    }));
    expect(outlineVisibleEntries(items, () => false)).toHaveLength(6);
    expect(
      outlineVisibleEntries(items, (item) => item.pos === 1).map(
        (entry) => entry.index,
      ),
    ).toEqual([0, 1, 4, 5]);
  });

  it("preserves source identity and offsets while supplying the common symbol presentation", () => {
    const symbol = {
      pos: 23,
      text: "run",
      level: 2,
      kind: "函数" as const,
      identity: "run",
      detail: "int",
    };
    const [item] = sourceOutlineItems([symbol]);
    expect(item).toMatchObject({
      ...symbol,
      offset: 23,
      kindSymbol: "ƒ",
      displayText: "run",
    });
    expect(symbol).not.toHaveProperty("offset");
  });
});
