import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  createDocumentKey,
  decryptDocument,
  encryptDocument,
  isEncrypted,
  openDocumentSession,
  unlockDocument,
} from "../../src/lib/document-crypto";
import { idbAdapter } from "../../src/lib/storage/idb";
import { protectedAdapter } from "../../src/lib/storage/protected-adapter";
import { withDB, getAll } from "../../src/lib/storage/db";
import {
  commitProtectionState,
  readProtectionState,
  listProtectedPaths,
} from "../../src/lib/storage/protection-state";
import {
  setDocumentPassword,
  setPathPassword,
  removeEmptyProtectedPath,
} from "../../src/lib/document-protection";
import {
  PasswordRequestCancelled,
  registerPasswordPrompt,
} from "../../src/lib/password-request";
import { NoteSearchIndex } from "../../src/lib/search-index-core";
import { buildSafeMergedBackup } from "../../src/lib/sync/backup-merge";

const adapter = protectedAdapter(idbAdapter);
const password = "密码 with spaces 123";
const body = {
  ops: [{ insert: "不可搜索的正文 secret-body\n" }],
  metadata: {
    bookmarks: [
      {
        id: "bookmark",
        position: 1,
        preview: "不可泄露的书签",
        createdAt: "now",
      },
    ],
  },
};
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  await withDB(async (db) => {
    const stores = [
      "notes",
      "note_versions",
      "images",
      "protected_paths",
      "daily_pages",
    ];
    const tx = db.transaction(stores, "readwrite");
    stores.forEach((name) => tx.objectStore(name).clear());
  });
  registerPasswordPrompt((prompt) => {
    if (prompt) void prompt.submit(password).catch(() => prompt.cancel());
  });
});
const create = (title = "公开标题", storagePath = "areas/private") =>
  adapter.createNote({ date: "2026-09-08", title, storagePath, content: body });

describe("document encryption", () => {
  it("cancelling path setup/removal or document setup leaves protection and content unchanged", async () => {
    const note = await create();
    const before = await readProtectionState();
    const cancel = registerPasswordPrompt((prompt) => prompt?.cancel());
    await expect(setPathPassword("areas/private")).rejects.toBeInstanceOf(
      PasswordRequestCancelled,
    );
    await expect(setDocumentPassword(note.id)).rejects.toBeInstanceOf(
      PasswordRequestCancelled,
    );
    expect(await readProtectionState()).toEqual(before);
    cancel();
    registerPasswordPrompt((prompt) => {
      if (prompt) void prompt.submit(password);
    });
    await setPathPassword("areas/private");
    const protectedState = await readProtectionState();
    const stop = registerPasswordPrompt((prompt) => prompt?.cancel());
    await expect(setPathPassword("areas/private", true)).rejects.toBeInstanceOf(
      PasswordRequestCancelled,
    );
    expect(await readProtectionState()).toEqual(protectedState);
    stop();
  });
  it("authenticated encryption preserves Unicode/metadata, randomizes every save and rejects wrong passwords/tampering", async () => {
    const key = await createDocumentKey(password);
    const a = await encryptDocument(body, key),
      b = await encryptDocument(body, key);
    expect(a.encrypted?.iv).not.toBe(b.encrypted?.iv);
    expect(JSON.stringify(a)).not.toContain("secret-body");
    expect((await unlockDocument(a, password)).content).toEqual(body);
    await expect(
      unlockDocument(a, password.trim() + "wrong"),
    ).rejects.toThrow();
    const corrupt = structuredClone(a);
    corrupt.encrypted!.data = "AAAA" + corrupt.encrypted!.data.slice(4);
    await expect(decryptDocument(corrupt, key)).rejects.toThrow();
    expect(key.key.extractable).toBe(false);
  });
  it("encrypts current and historic content; search never sees plaintext even while unlocked; edits and backups remain ciphertext", async () => {
    const note = await create();
    await adapter.createNoteCheckpoint(note.id);
    await setDocumentPassword(note.id);
    let stored = (await adapter.getNote(note.id))!;
    expect(isEncrypted(stored.content)).toBe(true);
    const unlocked = await unlockDocument(stored.content, password);
    const close = openDocumentSession(note.id, unlocked.key);
    const index = new NoteSearchIndex();
    index.rebuild([stored]);
    expect(index.search("secret-body")).toEqual([]);
    expect(index.search("公开标题")[0].search_text).toBe("");
    expect(await adapter.searchDocs({ text: "secret-body" })).toEqual([]);
    await adapter.updateNote(note.id, {
      content: { ops: [{ insert: "新的秘密 edited-secret\n" }] },
    });
    close();
    stored = (await adapter.getNote(note.id))!;
    expect(
      (await unlockDocument(stored.content, password)).content.ops[0].insert,
    ).toContain("edited-secret");
    const backup = await adapter.exportData();
    expect(backup).not.toMatch(/secret-body|edited-secret|不可泄露/);
    expect(JSON.parse(backup).version).toBe(2);
    const histories = await adapter.getNoteVersions(note.id);
    expect(histories.every((v) => isEncrypted(v.content))).toBe(true);
    await expect(adapter.exportNoteMarkdown(note.id)).rejects.toThrow(
      "加密文档",
    );
    await setDocumentPassword(note.id, true);
    expect(isEncrypted((await adapter.getNote(note.id))!.content)).toBe(false);
    expect(
      isEncrypted((await adapter.getNoteVersions(note.id))[0].content),
    ).toBe(false);
  });
  it("path password covers descendants and future imports; empty paths survive deletion, export/import and safe merge", async () => {
    const a = await create();
    const b = await create("嵌套", "areas/private/child/deep");
    await adapter.createNoteCheckpoint(b.id);
    await setPathPassword("areas/private/");
    for (const id of [a.id, b.id])
      expect(
        (await unlockDocument((await adapter.getNote(id))!.content, password))
          .content,
      ).toEqual(body);
    const c = await create("新文档", "areas/private/new");
    expect(isEncrypted(c.content)).toBe(true);
    await adapter.upsertNote({
      date: c.date,
      title: c.title!,
      storagePath: c.storagePath,
      content: body,
    });
    expect(isEncrypted((await adapter.getNote(c.id))!.content)).toBe(true);
    await adapter.batchDelete([a.id, b.id, c.id]);
    const tree = await adapter.getPathTree(false);
    expect(tree.find((n) => n.path === "areas/private")).toMatchObject({
      protectionRoot: true,
      count: 0,
    });
    const empty = await adapter.exportData();
    expect(JSON.parse(empty).notes).toHaveLength(0);
    expect(JSON.parse(empty).protected_paths).toHaveLength(1);
    const merged = buildSafeMergedBackup(
      empty,
      JSON.stringify({ version: 1, notes: [], daily_pages: [] }),
    ).json;
    expect(JSON.parse(merged).protected_paths).toHaveLength(1);
    await adapter.importData(merged, "replace");
    expect(await listProtectedPaths()).toHaveLength(1);
    await removeEmptyProtectedPath("areas/private");
    expect(await listProtectedPaths()).toEqual([]);
    expect(
      (await adapter.getPathTree(false)).some(
        (n) => n.path === "areas/private",
      ),
    ).toBe(false);
  });
  it("moves documents across protection boundaries without implicit plaintext and preserves path identity on rename", async () => {
    const source = await create("来源", "areas/public");
    await setPathPassword("areas/private");
    await adapter.moveDocument(source.id, "areas/private/child");
    const encrypted = (await adapter.getNote(source.id))!.content;
    expect(isEncrypted(encrypted)).toBe(true);
    await adapter.moveDocument(source.id, "areas/public");
    expect((await adapter.getNote(source.id))!.content).toEqual(encrypted);
    const pathId = (await listProtectedPaths())[0].id;
    await adapter.relocateFolder("areas/private", "areas/renamed");
    expect((await listProtectedPaths())[0]).toMatchObject({
      id: pathId,
      path: "areas/renamed",
    });
    await expect(setPathPassword("areas/renamed/child")).rejects.toThrow(
      "父子路径",
    );
  });
  it("CAS rejects concurrent changes without rewriting any note or path", async () => {
    const note = await create();
    const before = await readProtectionState();
    const after = structuredClone(before);
    after.notes[0].title = "不应写入";
    await adapter.updateNote(note.id, { title: "其他窗口" });
    await expect(commitProtectionState(before, after)).rejects.toThrow(
      "其他窗口",
    );
    expect((await adapter.getNote(note.id))!.title).toBe("其他窗口");
    expect(await listProtectedPaths()).toEqual([]);
  });
  it("raw search_text and bookmark metadata disappear atomically with encryption", async () => {
    const note = await create();
    await setDocumentPassword(note.id);
    const records = await withDB((db) =>
      getAll(db.transaction("notes").objectStore("notes")),
    );
    expect(JSON.stringify(records)).not.toContain("secret-body");
    expect(JSON.stringify(records)).not.toContain("不可泄露");
  });
});
