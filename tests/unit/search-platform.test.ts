import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Note } from "../../src/types/models";
import type { StorageAdapter } from "../../src/lib/storage/types";
import {
  NoteSearchIndex,
  type SearchNote,
} from "../../src/lib/search-index-core";
import {
  createDocumentKey,
  encryptDocument,
} from "../../src/lib/document-crypto";

const runtime = vi.hoisted(() => ({ native: false }));
vi.mock("../../src/lib/runtime", () => ({
  isTauriRuntime: () => runtime.native,
}));
vi.mock("../../src/lib/storage", () => ({ getAdapter: vi.fn() }));
import {
  invalidateWebSearchIndex,
  searchWebNoteSummaries,
  searchDocumentSummaries,
} from "../../src/lib/web-search-index";

const note = (id: string, title: string, body: string): Note => ({
  id,
  title,
  content: { ops: [{ insert: body }] },
  date: "2026-09-09",
  tags: [],
  pinned: false,
  readonly: false,
  sort_order: 0,
  created_at: "2026-09-09",
  updated_at: "2026-09-09",
});
let notes: Note[];
let adapter: StorageAdapter;
const getAll = vi.fn();
const nativeSearch = vi.fn();
const documents = vi.fn();

it("document filters preserve multi-term matching/ranking and exact path boundaries on both runtimes", async () => {
  const docs: Note[] = [
    {
      ...note("match", "ＡＢＣ", "性能"),
      storagePath: "projects/foo/child",
      docType: "reference",
      concepts: ["网络"],
    },
    {
      ...note("sibling", "ＡＢＣ", "性能"),
      storagePath: "projects/foobar",
      docType: "reference",
      concepts: ["网络"],
    },
    {
      ...note("type", "ＡＢＣ", "性能"),
      storagePath: "projects/foo",
      docType: "tutorial",
      concepts: ["网络"],
    },
    {
      ...note("concept", "ＡＢＣ", "性能"),
      storagePath: "projects/foo",
      docType: "reference",
      concepts: ["网络安全"],
    },
  ];
  notes = [note("essay", "ABC", "性能")];
  documents.mockResolvedValue(docs);
  for (const native of [false, true]) {
    for (const worker of [SearchWorker, undefined, CrashedWorker]) {
      invalidateWebSearchIndex();
      runtime.native = native;
      vi.stubGlobal("Worker", worker);
      const all = await searchWebNoteSummaries(adapter, "abc 性能");
      const filtered = await searchDocumentSummaries(adapter, {
        text: "abc 性能",
        storagePath: "projects/foo",
        docType: "reference",
        concept: "网络",
      });
      expect(filtered.map((n) => n.id)).toEqual(["match"]);
      expect(filtered).toEqual(all.filter((n) => n.id === "match"));
      expect(
        await searchDocumentSummaries(adapter, {
          text: "abc 性能",
          storagePath: "projects/foo",
          staleBefore: "2026-09-09",
        }),
      ).toEqual([]);
      expect(
        (
          await searchDocumentSummaries(adapter, {
            text: " \t ",
            storagePath: "projects/foo",
            docType: "reference",
            concept: "网络",
            staleBefore: "2026-09-10",
          })
        ).map((n) => n.id),
      ).toEqual(["match"]);
    }
  }
  expect(
    documents.mock.calls.every(([query]) => Object.keys(query).length === 0),
  ).toBe(true);
  expect(nativeSearch).not.toHaveBeenCalled();
});

class SearchWorker {
  index = new NoteSearchIndex();
  onmessage?: (event: { data: { id: number; result: unknown } }) => void;
  onerror?: () => void;
  terminate() {}
  postMessage(message: {
    id: number;
    type: string;
    notes: SearchNote[];
    query: string;
  }) {
    if (message.type === "rebuild") this.index.rebuild(message.notes);
    const result =
      message.type === "rebuild"
        ? this.index.size
        : this.index.search(message.query);
    queueMicrotask(() =>
      this.onmessage?.({ data: { id: message.id, result } }),
    );
  }
}

class CrashedWorker extends SearchWorker {
  postMessage() {
    queueMicrotask(() => this.onerror?.());
  }
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  runtime.native = false;
  notes = [
    note("body", "其它", "搜索 索引 ABC"),
    note("title", "搜索 索引", "内容"),
    {
      ...note("path", "路径文档", "body"),
      storagePath: "areas/network",
      tags: ["ＤＰＤＫ"],
      concepts: ["性能"],
    },
  ];
  getAll.mockReset().mockImplementation(async () => notes);
  nativeSearch.mockReset().mockResolvedValue([]);
  documents.mockReset().mockResolvedValue([]);
  adapter = {
    getAllNotes: getAll,
    searchNotes: nativeSearch,
    searchDocs: documents,
  } as unknown as StorageAdapter;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  invalidateWebSearchIndex();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("uses identical matching, normalization, ranking and snippets without a Worker or after construction failure", async () => {
  const queries = ["搜索 索引", "abc", "dpdk 性能", "areas/network", "不存在"];
  vi.stubGlobal("Worker", SearchWorker);
  const expected = await Promise.all(
    queries.map((query) => searchWebNoteSummaries(adapter, query)),
  );
  expect(expected[0].map((note) => note.id)).toEqual(["title", "body"]);
  expect(expected[2].map((note) => note.id)).toEqual(["path"]);
  for (const worker of [
    CrashedWorker,
    undefined,
    class {
      constructor() {
        throw new Error("blocked");
      }
    },
  ]) {
    invalidateWebSearchIndex();
    vi.stubGlobal("Worker", worker);
    for (const [index, query] of queries.entries())
      expect(await searchWebNoteSummaries(adapter, query)).toEqual(
        expected[index],
      );
  }
  expect(nativeSearch).not.toHaveBeenCalled();
});

it("returns no results for blank queries without calling either backend", async () => {
  for (const native of [false, true]) {
    runtime.native = native;
    expect(await searchWebNoteSummaries(adapter, " \n\t ")).toEqual([]);
  }
  expect(getAll).not.toHaveBeenCalled();
  expect(nativeSearch).not.toHaveBeenCalled();
  expect(documents).not.toHaveBeenCalled();
});

it("does not cache stale fallback results or expose encrypted body/search_text", async () => {
  vi.stubGlobal("Worker", undefined);
  const sealed = await encryptDocument(
    { ops: [{ insert: "secret-body" }] },
    await createDocumentKey("test-password"),
  );
  const protectedNote = {
    ...note("protected", "公开标题", ""),
    content: sealed,
    search_text: "secret-body",
  };
  notes = [protectedNote];
  documents.mockResolvedValue([
    { ...protectedNote, storagePath: "private/doc", docType: "reference" },
  ]);
  expect(
    await searchDocumentSummaries(adapter, {
      text: "secret-body",
      storagePath: "private",
    }),
  ).toEqual([]);
  const protectedResults = await searchDocumentSummaries(adapter, {
    storagePath: "private",
    docType: "reference",
  });
  expect(protectedResults).toHaveLength(1);
  expect(protectedResults[0].search_text).toBe("");
  expect(protectedResults[0]).not.toHaveProperty("content");
  documents.mockResolvedValue([]);
  expect(await searchWebNoteSummaries(adapter, "secret-body")).toEqual([]);
  expect(
    (await searchWebNoteSummaries(adapter, "公开标题"))[0].search_text,
  ).toBe("");
  notes = [note("new", "新增", "内容")];
  expect((await searchWebNoteSummaries(adapter, "新增"))[0].id).toBe("new");
  expect(await searchWebNoteSummaries(adapter, "公开标题")).toEqual([]);
  runtime.native = true;
  notes = [protectedNote];
  expect(
    (await searchWebNoteSummaries(adapter, "公开标题"))[0].search_text,
  ).toBe("");
});

it("uses the same complete corpus and stable ordering on Web and native, including more than 80 documents", async () => {
  const docs = Array.from({ length: 105 }, (_, i) => ({
    ...note(`doc-${String(i).padStart(3, "0")}`, "测试 ＡＢＣ", "性能 正文"),
    storagePath: "areas/network",
    tags: ["ＤＰＤＫ"],
  }));
  notes = [note("essay", "测试 ABC", "性能")];
  let expected: SearchNote[] | undefined;
  for (const native of [false, true]) {
    for (const worker of [SearchWorker, undefined, CrashedWorker]) {
      invalidateWebSearchIndex();
      runtime.native = native;
      vi.stubGlobal("Worker", worker);
      documents.mockResolvedValue(native ? [...docs].reverse() : docs);
      const results = await searchWebNoteSummaries(adapter, " abc 性能 ");
      expect(results).toHaveLength(106);
      expected ??= results;
      expect(results).toEqual(expected);
      expect(
        await searchWebNoteSummaries(adapter, "network dpdk"),
      ).toHaveLength(105);
    }
  }
  expect(documents).toHaveBeenCalledWith({});
  expect(nativeSearch).not.toHaveBeenCalled();
});
