import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), create: vi.fn() }));
vi.mock("../../src/lib/api", () => ({
  api: { docs: { search: mocks.search }, notes: { create: mocks.create } },
}));
import {
  ensureMarkdownDemo,
  MARKDOWN_DEMO_KEY,
  MARKDOWN_DEMO_TITLE,
} from "../../src/lib/markdown-demo";
import { deltaToProseMirror } from "../../src/lib/delta-converter";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  mocks.search.mockReset().mockResolvedValue([]);
  mocks.create.mockReset().mockResolvedValue({ id: "demo" });
});
afterEach(() => vi.unstubAllGlobals());

test("creates one ideas document and preserves source syntax for viewing", async () => {
  await Promise.all([ensureMarkdownDemo(), ensureMarkdownDemo()]);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  const input = mocks.create.mock.calls[0][0];
  expect(input).toMatchObject({
    title: MARKDOWN_DEMO_TITLE,
    storagePath: "ideas",
    docType: "reference",
  });
  const source = input.content.metadata.markdownSource;
  expect(source).toContain("[^first-note]:");
  expect(source.indexOf("[^first-note]:")).toBeLessThan(
    source.indexOf("## 八、"),
  );
  const doc = deltaToProseMirror(input.content);
  const types = new Set<string>();
  const walk = (node: typeof doc) => {
    types.add(node.type!);
    node.content?.forEach(walk);
  };
  walk(doc);
  const autolinks = doc.content
    ?.filter((node) => node.type === "bulletList")
    .flatMap((list) => list.content ?? [])
    .flatMap((item) => item.content ?? [])
    .flatMap((paragraph) => paragraph.content ?? [])
    .flatMap((node) => node.marks ?? [])
    .filter((mark) => mark.type === "link")
    .map((mark) => mark.attrs?.href);
  for (const href of [
    "https://github.github.com/gfm/",
    "http://www.github.com",
    "mailto:demo@example.com",
  ])
    expect(autolinks).toContain(href);
  expect(autolinks?.some((href) => /[、，]/u.test(href ?? ""))).toBe(false);
  for (const type of [
    "heading",
    "bulletList",
    "orderedList",
    "blockquote",
    "codeBlock",
    "table",
    "markdownImage",
    "mathBlock",
    "mathInline",
    "htmlDetails",
    "footnotes",
    "htmlAnchor",
  ])
    expect(types.has(type), type).toBe(true);
  expect(source).toContain("```toc");
  expect(source).toContain("````flow");
  await ensureMarkdownDemo();
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
test("adopts a synced demo without replacing its content", async () => {
  mocks.search.mockResolvedValue([
    { id: "synced", title: MARKDOWN_DEMO_TITLE, storagePath: "ideas" },
  ]);
  expect(await ensureMarkdownDemo()).toBe(false);
  expect(localStorage.getItem(MARKDOWN_DEMO_KEY)).toBe("synced");
  expect(mocks.create).not.toHaveBeenCalled();
});
test("does not resurrect a deleted, moved or renamed demo", async () => {
  localStorage.setItem(MARKDOWN_DEMO_KEY, "previous-demo");
  expect(await ensureMarkdownDemo()).toBe(false);
  expect(mocks.search).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
test("failed persistence remains retryable", async () => {
  mocks.create.mockRejectedValueOnce(new Error("disk full"));
  await expect(ensureMarkdownDemo()).rejects.toThrow("disk full");
  expect(localStorage.getItem(MARKDOWN_DEMO_KEY)).toBeNull();
  expect(await ensureMarkdownDemo()).toBe(true);
});
