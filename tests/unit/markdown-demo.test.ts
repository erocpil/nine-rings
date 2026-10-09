import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  selected: null as { id: string; readonly: boolean } | null,
}));
vi.mock("../../src/lib/api", () => ({
  api: {
    docs: { search: mocks.search },
    notes: { create: mocks.create, get: mocks.get, update: mocks.update },
  },
}));
vi.mock("../../src/stores/useNotesStore", () => ({
  useNotesStore: {
    getState: () => ({
      selectedNote: mocks.selected,
      selectNote: mocks.select,
    }),
  },
}));
import markdown from "../../src/lib/markdown-demo.md?raw";
import { buildMarkdownImportInput } from "../../src/lib/markdown-import";
import {
  ensureMarkdownDemo,
  MARKDOWN_DEMO_KEY,
  MARKDOWN_DEMO_TITLE,
  MARKDOWN_DEMO_FLOW_KEY,
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
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.update
    .mockReset()
    .mockImplementation(async (id, changes) => ({ id, ...changes }));
  mocks.select.mockReset();
  mocks.selected = null;
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
    ?.filter(
      (node) =>
        node.type === "paragraph" &&
        node.content?.some((child) =>
          child.text?.startsWith("GFM 扩展自动链接："),
        ),
    )
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

function oldDemo(custom = false) {
  const source =
    "用户补充，保留原文。\n\n" +
    markdown.replace(/^### (捕捉|行动|复核)$/gm, "## $1");
  const content = buildMarkdownImportInput(
    "markdown-demo.md",
    custom ? source.replace("## 捕捉", "## 自定义捕捉") : source,
    { date: "2026-10-10", storagePath: "ideas" },
  ).content;
  return {
    id: "old-demo",
    title: MARKDOWN_DEMO_TITLE,
    storagePath: "ideas",
    content,
  };
}
test("upgrades only the unchanged old flow snippet, preserving other content and original source", async () => {
  const note = oldDemo();
  mocks.get.mockResolvedValue(note);
  localStorage.setItem(MARKDOWN_DEMO_KEY, note.id);
  expect(await ensureMarkdownDemo()).toBe(true);
  const updated = mocks.update.mock.calls[0][1].content;
  expect(updated.metadata.markdownSource).toBe(
    "用户补充，保留原文。\n\n" + markdown,
  );
  expect(deltaToProseMirror(updated)).toEqual(
    deltaToProseMirror(
      buildMarkdownImportInput(
        "markdown-demo.md",
        updated.metadata.markdownSource,
        { date: "2026-10-10", storagePath: "ideas" },
      ).content,
    ),
  );
  expect(
    updated.ops.filter(
      (op: unknown, i: number) =>
        JSON.stringify(op) !== JSON.stringify(note.content.ops[i]),
    ),
  ).toHaveLength(1);
  await ensureMarkdownDemo();
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
test("does not overwrite a customized flow or recreate a deleted demo", async () => {
  const note = oldDemo(true);
  mocks.get.mockResolvedValue(note);
  localStorage.setItem(MARKDOWN_DEMO_KEY, note.id);
  expect(await ensureMarkdownDemo()).toBe(false);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
test("defers an editable mounted demo, but refreshes the readonly one", async () => {
  const note = oldDemo();
  mocks.get.mockResolvedValue(note);
  localStorage.setItem(MARKDOWN_DEMO_KEY, note.id);
  mocks.selected = { id: note.id, readonly: false };
  expect(await ensureMarkdownDemo()).toBe(false);
  expect(localStorage.getItem(MARKDOWN_DEMO_FLOW_KEY)).toBeNull();
  mocks.selected = { id: note.id, readonly: true };
  expect(await ensureMarkdownDemo()).toBe(true);
  expect(mocks.select).toHaveBeenCalledOnce();
});
test("failed flow upgrade stays retryable", async () => {
  const note = oldDemo();
  mocks.get.mockResolvedValue(note);
  localStorage.setItem(MARKDOWN_DEMO_KEY, note.id);
  mocks.update.mockRejectedValueOnce(new Error("disk full"));
  await expect(ensureMarkdownDemo()).rejects.toThrow("disk full");
  expect(localStorage.getItem(MARKDOWN_DEMO_FLOW_KEY)).toBeNull();
  expect(await ensureMarkdownDemo()).toBe(true);
});
