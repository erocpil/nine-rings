import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeAttributes } from "@tiptap/core";
import { withDB, getAll } from "../../src/lib/storage/db";
import { idbAdapter } from "../../src/lib/storage/idb";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { storeImage, resolveImageRefs } from "../../src/lib/storage/db-images";
import { validateBackup } from "../../src/lib/backup-validation";
import { withFrontendSettings } from "../../src/lib/backup-user-settings";
import {
  extractSnippet,
  snippetParts,
} from "../../src/lib/storage/idb-snippet";
import { downloadExternalMarkdown } from "../../src/lib/external-markdown-source";
import { NoteSearchIndex } from "../../src/lib/search-index-core";
import {
  loadSyncConfig,
  saveSyncConfig,
  pushToGitHub,
  previewPullFromGitHub,
  formatBackupDevice,
} from "../../src/lib/sync/github";
import { buildSafeMergedBackup } from "../../src/lib/sync/backup-merge";
import {
  listLocalPdfs,
  resetPdfLibraryConnectionForTests,
} from "../../src/lib/pdf-library";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
};
const note = (id: string) => ({
  id,
  title: id,
  date: "2026-09-06",
  content: { ops: [{ insert: "正文\n" }] },
  tags: [],
  pinned: false,
  readonly: false,
  sort_order: 0,
  created_at: "2026-09-06",
  updated_at: "2026-09-06",
});
beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", memoryStorage());
  await importData(JSON.stringify({ notes: [] }), "replace");
});

describe("backup failure boundaries", () => {
  it("identifies the remote device when precheck rejects an invalid backup", async () => {
    const payloads = [
      "20260907T120000",
      JSON.stringify({
        notes: "invalid",
        backup_metadata: { device: { name: "Windows", id: "12345678-abcd" } },
      }),
    ];
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sha: "abc123",
            encoding: "base64",
            content: btoa(payloads.shift()!),
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      previewPullFromGitHub({
        ...loadSyncConfig(),
        token: "dummy",
        owner: "owner",
        repo: "repo",
      }),
    ).rejects.toThrow(
      /notes 数组\n远端版本：20260907T120000\n远端备份来源：Windows · 设备ID 12345678/,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await idbAdapter.getAllNotes()).toEqual([]);
  });

  it.each([
    [undefined, "未知设备（备份未记录设备信息）"],
    [{ name: "Phone" }, "Phone"],
    [{ id: "12345678-abcd" }, "设备ID 12345678"],
    [{ name: " ", runtime: "tauri", platform: "Windows" }, "tauri / Windows"],
  ])(
    "formats partial device metadata without broken labels",
    (device, label) => {
      expect(formatBackupDevice(device)).toBe(label);
    },
  );
  it.each([null, [], {}, { sha: 42 }, { sha: "" }])(
    "rejects an invalid remote pointer envelope before uploading: %j",
    async (value) => {
      const fetch = vi.fn(
        async () => new Response(JSON.stringify(value), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        pushToGitHub({
          ...loadSyncConfig(),
          token: "dummy",
          owner: "owner",
          repo: "repo",
        }),
      ).rejects.toThrow("有效 sha");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]).toBeDefined();
    },
  );
  it("keeps both template versions in a conflict and does not propagate deletion", () => {
    const template = {
      id: "t",
      name: "base",
      tags: [],
      concepts: [],
      is_builtin: true,
    };
    const bundle = (templates: unknown[]) =>
      JSON.stringify({ version: 1, notes: [], templates });
    const result: { templates: (typeof template)[] } = JSON.parse(
      buildSafeMergedBackup(
        bundle([
          { ...template, name: "local" },
          { ...template, id: "only-local" },
        ]),
        bundle([{ ...template, name: "remote" }]),
        bundle([template]),
      ).json,
    );
    expect(result.templates).toHaveLength(3);
    expect(result.templates.find((t) => t.id === "t")?.name).toBe("remote");
    expect(
      result.templates.some(
        (t) => t.name.includes("local") && !t.is_builtin && t.id !== "t",
      ),
    ).toBe(true);
    expect(result.templates.some((t) => t.id === "only-local")).toBe(true);
    const legacy = JSON.stringify({
      notes: [],
      user_settings: {
        values: {
          "nine-rings:templates": [{ ...template, id: "legacy-remote" }],
        },
      },
    });
    const migrated: { templates: (typeof template)[] } = JSON.parse(
      buildSafeMergedBackup(bundle([template]), legacy).json,
    );
    expect(migrated.templates.map((t) => t.id).sort()).toEqual([
      "legacy-remote",
      "t",
    ]);
  });
  it("allows a retry after a synchronous IndexedDB open failure", async () => {
    await withDB(async (db) =>
      db.onversionchange?.call(db, new IDBVersionChangeEvent("versionchange")),
    );
    await resetPdfLibraryConnectionForTests();
    const fail = () => {
      throw new DOMException("temporarily unavailable", "SecurityError");
    };
    const open = vi
      .spyOn(indexedDB, "open")
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail);
    try {
      await expect(withDB(async () => undefined)).rejects.toThrow(
        "temporarily unavailable",
      );
      await expect(listLocalPdfs()).rejects.toThrow("temporarily unavailable");
    } finally {
      open.mockRestore();
    }
    await expect(withDB(async () => "reopened")).resolves.toBe("reopened");
    await expect(listLocalPdfs()).resolves.toEqual([]);
  });
  it("rolls back frontend settings before acknowledging a failed import", async () => {
    const storage = memoryStorage();
    storage.setItem("nr:focusMode", "false");
    const settings = { values: { "nr:focusMode": true, "nr:lastNote": "new" } };
    await expect(
      withFrontendSettings(
        settings,
        async () => {
          throw new Error("DB abort");
        },
        storage,
      ),
    ).rejects.toThrow("DB abort");
    expect(storage.getItem("nr:focusMode")).toBe("false");
    expect(storage.getItem("nr:lastNote")).toBeNull();
    const commit = vi.fn(async () => undefined);
    const limited = {
      ...storage,
      setItem(key: string, value: string) {
        if (key === "nr:lastNote") throw new Error("quota");
        storage.setItem(key, value);
      },
    };
    await expect(
      withFrontendSettings(settings, commit, limited),
    ).rejects.toThrow("quota");
    expect(commit).not.toHaveBeenCalled();
    expect(storage.getItem("nr:focusMode")).toBe("false");
  });
  it("validates all records before replace or settings writes", async () => {
    await importData(JSON.stringify({ notes: [note("original")] }));
    for (const mode of ["replace", "merge"] as const) {
      await expect(
        importData(
          JSON.stringify({
            notes: [note("partial"), { ...note(""), id: undefined }],
            config: { theme: "dark" },
          }),
          mode,
        ),
      ).rejects.toThrow();
      expect(await idbAdapter.getNote("original")).not.toBeNull();
      expect(await idbAdapter.getNote("partial")).toBeNull();
      expect(localStorage.getItem("nine_rings_config")).toBeNull();
    }
  });
  it.each([
    {},
    { notes: {} },
    { notes: [note("a"), note("a")] },
    { notes: [note("a")], daily_pages: [{}] },
    { notes: [], config: [] },
    { notes: [], version: 99 },
    JSON.parse('{"notes":[],"__proto__":{"onerror":"x"}}'),
  ])("rejects malformed bundle %j", (value) => {
    expect(() => validateBackup(value)).toThrow();
  });
  it("does not acknowledge request success when the transaction aborts", async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const req = original.apply(this, args);
      if (this.name === "notes") {
        const tx = this.transaction;
        req.addEventListener(
          "success",
          () => queueMicrotask(() => tx.abort()),
          { once: true },
        );
      }
      return req;
    };
    try {
      await expect(
        idbAdapter.createNote({ date: "2026-09-06", title: "aborted" }),
      ).rejects.toThrow();
      await expect(
        importData(
          JSON.stringify({
            notes: [note("partial")],
            config: { theme: "dark" },
          }),
          "replace",
        ),
      ).rejects.toThrow();
      expect(localStorage.getItem("nine_rings_config")).toBeNull();
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(
      await withDB((db) =>
        getAll(db.transaction("notes").objectStore("notes")),
      ),
    ).toEqual([]);
  });
  it("aborts clears and queued writes on synchronous failure", async () => {
    await importData(JSON.stringify({ notes: [note("original")] }));
    await expect(
      withDB(async (db) => {
        const store = db.transaction("notes", "readwrite").objectStore("notes");
        store.clear();
        store.put(note("partial"));
        store.put({});
      }),
    ).rejects.toThrow();
    expect(await idbAdapter.getNote("original")).not.toBeNull();
    expect(await idbAdapter.getNote("partial")).toBeNull();
  });
  it("exports multiple/nested images after read transactions finish", async () => {
    class AsyncReader {
      result = "";
      onload?: () => void;
      readAsDataURL(blob: Blob) {
        setTimeout(async () => {
          this.result =
            "data:image/png;base64," +
            Buffer.from(await blob.arrayBuffer()).toString("base64");
          this.onload?.();
        }, 10);
      }
    }
    vi.stubGlobal("FileReader", AsyncReader);
    const first = await storeImage(new Blob(["first"]));
    const second = await storeImage(new Blob(["second"]));
    const content = {
      ops: [
        { insert: { image: first } },
        { insert: { resizableImage: { src: second } } },
        {
          insert: {
            table: {
              rows: [
                {
                  cells: [{ content: { ops: [{ insert: { image: first } }] } }],
                },
              ],
            },
          },
        },
      ],
    };
    await importData(
      JSON.stringify({ notes: [{ ...note("images"), content }] }),
    );
    const exported = await exportData();
    expect(exported).not.toContain("nr-image://");
    const { tauriAdapter } = await import("../../src/lib/storage/tauri");
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("export_data");
      return JSON.stringify({
        version: 1,
        notes: [{ ...note("images"), content }],
        templates: [],
      });
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const nativeExport = await tauriAdapter.exportData();
    expect(nativeExport).not.toContain("nr-image://");
    expect(JSON.parse(nativeExport).notes[0].content).toEqual(
      JSON.parse(exported).notes[0].content,
    );
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", memoryStorage());
    expect(exported).toContain("data:image/png;base64,");
    expect(JSON.stringify(content)).toContain("nr-image://");
    await withDB(async (db) => {
      db.transaction("images", "readwrite").objectStore("images").clear();
    });
    await importData(exported, "replace");
    expect(
      JSON.stringify((await idbAdapter.getNote("images"))?.content),
    ).not.toContain("nr-image://");
    await expect(resolveImageRefs({ attrs: { src: first } })).rejects.toThrow(
      "缺少本地图片",
    );
  });
  it("reports missing image references with document context", async () => {
    localStorage.setItem("nr:backup-device-id", "local123-test");
    await withDB(async (db) => {
      db.transaction("images", "readwrite").objectStore("images").clear();
    });
    const noteWithImage = {
      id: "doc-1",
      title: "带图文档",
      date: "2026-09-06",
      storagePath: "areas/private",
      content: {
        ops: [
          {
            insert: {
              image: "nr-image://9f7a9c2d-0000-4e55-bf1b-111111111111",
            },
          },
        ],
      },
      tags: [],
      pinned: false,
      readonly: false,
      sort_order: 0,
      created_at: "2026-09-06",
      updated_at: "2026-09-06",
    };
    await expect(resolveImageRefs([noteWithImage] as const)).rejects.toThrow(
      /local123[\s\S]*带图文档[\s\S]*areas\/private[\s\S]*doc-1/,
    );
  });
  it("round-trips explicit templates in a fresh frontend store", async () => {
    const template = {
      id: "custom",
      name: "自定义",
      description: "",
      is_builtin: false,
      title_template: "title",
      tags: [],
      concepts: [],
      storage_path: null,
      doc_type: null,
      pinned: false,
      sort_order: 0,
      created_at: "now",
      updated_at: "now",
    };
    await importData(JSON.stringify({ notes: [], templates: [template] }));
    const exported = await exportData();
    localStorage.removeItem("nine-rings:templates");
    await importData(exported, "replace");
    expect(JSON.parse(localStorage.getItem("nine-rings:templates")!)).toEqual([
      template,
    ]);
  });
  it("does not alter notes when settings cannot be staged", async () => {
    await importData(JSON.stringify({ notes: [note("original")] }));
    localStorage.setItem = () => {
      throw new Error("quota");
    };
    await expect(
      importData(
        JSON.stringify({ notes: [], config: { theme: "dark" } }),
        "replace",
      ),
    ).rejects.toThrow("quota");
    expect(await idbAdapter.getNote("original")).not.toBeNull();
  });
  it("can reopen the main database after connection invalidation", async () => {
    await withDB(async (db) => {
      db.onversionchange?.call(db, new IDBVersionChangeEvent("versionchange"));
    });
    await idbAdapter.createNote({ date: "2026-09-06", title: "reopened" });
    expect((await idbAdapter.getAllNotes()).length).toBe(1);
  });
});

describe("security and bounded data", () => {
  it("keeps HTML inert and highlights multiple literal terms", () => {
    const text = '<img src=x onerror="test()"> 色彩 rgba';
    expect(extractSnippet(text, "色 rgba")).toContain("&lt;img");
    expect(extractSnippet(text, "missing")).not.toContain("<img");
    expect(
      snippetParts(text, "色 rgba")
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual(["色", "rgba"]);
  });
  it("locked Tiptap release blocks the advisory prototype payload", () => {
    const merged = mergeAttributes(
      JSON.parse('{"__proto__":{"src":"x","onerror":"test"}}'),
    );
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.onerror).toBeUndefined();
    expect(merged.src).toBeUndefined();
  });
  it("search results contain neither rich content nor full-length plaintext", () => {
    const index = new NoteSearchIndex();
    index.upsert({
      ...note("a"),
      content: {
        ops: [{ insert: "A".repeat(10000) + "needle" + "B".repeat(10000) }],
      },
    });
    const result = index.search("needle")[0];
    expect(result).not.toHaveProperty("content");
    expect(result.search_text.length).toBeLessThan(200);
    expect(result.search_text).toContain("needle");
    index.rebuild([
      note("a"),
      { ...note("b"), title: "a", pinned: true },
      { ...note("c"), title: "a longer" },
    ]);
    expect(index.size).toBe(3);
    expect(index.search("a").map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(index.search(" ")).toEqual([]);
    index.remove("a");
    expect(index.size).toBe(2);
  });
  it("Tauri respects session-only tokens and migrates legacy storage", () => {
    const local = memoryStorage(),
      session = memoryStorage();
    vi.stubGlobal("window", {
      isTauri: true,
      localStorage: local,
      sessionStorage: session,
    });
    local.setItem(
      "nr:github-sync",
      JSON.stringify({ token: "dummy", rememberToken: false }),
    );
    const config = loadSyncConfig();
    expect(config.token).toBe("dummy");
    expect(local.getItem("nr:github-sync")).not.toContain("dummy");
    expect(session.getItem("nr:github-sync-token")).toBe("dummy");
    saveSyncConfig({ ...config, rememberToken: true });
    expect(local.getItem("nr:github-sync-token")).toBe("dummy");
    saveSyncConfig({ ...config, rememberToken: false });
    expect(local.getItem("nr:github-sync-token")).toBeNull();
  });
  it("cancels a chunked download immediately at its size budget", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(100));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      downloadExternalMarkdown("https://example.com/book.md", {
        maxBytes: 120,
        fetchImpl: async () => new Response(stream),
      }),
    ).rejects.toThrow("上限");
    expect(cancelled).toBe(true);
    const fetchImpl = vi.fn();
    await expect(
      downloadExternalMarkdown("https://example.com/book.md", {
        signal: AbortSignal.abort(),
        fetchImpl,
      }),
    ).rejects.toThrow("取消");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
