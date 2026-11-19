import { describe, expect, it, vi } from "vitest";
import {
  BufferSaveCancelled,
  createBufferDocumentHost,
  type BufferRecord,
  type BufferDocumentPort,
} from "../../src/apps/file-workbench/buffer-documents";
import type { LocalSourceHost } from "../../src/lib/local-files/source-host";
import type { BrowserDirectoryProvider } from "../../src/lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../src/lib/local-files/file-model";

function fixture(path: string | null = null) {
  let record: BufferRecord = {
    id: "buffer-1",
    name: "未命名",
    source: "",
    version: 1,
    path,
    baseSource: "",
    baseRevision: "base",
    createdAt: 1,
    bom: false,
    lineEnding: "lf",
  };
  const snapshot: LocalFileSnapshot = {
    source: "",
    revision: "base",
    size: 0,
    modifiedMs: 0,
    bom: false,
    lineEnding: "lf",
  };
  const versions: number[] = [];
  const port: BufferDocumentPort = {
    create: vi.fn(),
    discard: vi.fn(),
    read: async () => record,
    snapshot: async () => snapshot,
    checkpoint: async (_id, version, source) => {
      expect(version).toBe(record.version);
      versions.push(version);
      record = { ...record, source, version: version + 1 };
      return record;
    },
    save: vi.fn(async () => null),
  };
  const original = {
    drafts: { remove: vi.fn() },
    assertActive: vi.fn(),
    saveCopy: vi.fn(),
  } as unknown as LocalSourceHost;
  const binding = createBufferDocumentHost(
    record,
    original,
    {} as BrowserDirectoryProvider,
    vi.fn(),
    port,
  );
  const draft = (source: string) => ({
    identity: "test",
    source,
    baseSource: "",
    baseRevision: "base",
    bom: false,
    lineEnding: "lf" as const,
    savedAt: 1,
  });
  return {
    binding,
    port,
    snapshot,
    versions,
    original,
    draft,
    record: () => record,
  };
}
describe("persistent workbench documents", () => {
  it("serializes checkpoints and explicit save; cancelling preserves the latest text", async () => {
    const value = fixture();
    const first = value.binding.host.drafts.write(value.draft("first"));
    const save = value.binding.host.write(
      "virtual",
      "buffer-1",
      "second",
      value.snapshot,
    );
    await first;
    await expect(save).rejects.toBeInstanceOf(BufferSaveCancelled);
    expect(value.record().source).toBe("second");
    expect(value.versions).toEqual([1, 2]);
    expect(value.original.drafts.remove).not.toHaveBeenCalled();
    expect(await value.binding.host.drafts.read("virtual")).toBeNull();
  });
  it("undo to initial text persists and failed checkpoints do not poison the queue", async () => {
    const value = fixture();
    await value.binding.host.drafts.write(value.draft("typed"));
    const checkpoint = value.port.checkpoint;
    value.port.checkpoint = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      value.binding.host.drafts.write(value.draft("")),
    ).rejects.toThrow("disk full");
    expect(value.record().source).toBe("typed");
    value.port.checkpoint = checkpoint;
    await value.binding.host.drafts.write(value.draft(""));
    expect(value.record().source).toBe("");
  });
  it("first save updates identity metadata and later saves retain the selected path", async () => {
    const value = fixture();
    value.port.save = async (_id, source) => ({
      record: {
        ...value.record(),
        path: "/chosen/new.txt",
        name: "new.txt",
        source,
        baseSource: source,
        version: value.record().version + 1,
      },
      snapshot: { ...value.snapshot, source, revision: "saved" },
    });
    await expect(
      value.binding.host.write(
        "virtual",
        "buffer-1",
        "saved text",
        value.snapshot,
      ),
    ).resolves.toMatchObject({ source: "saved text" });
    expect(
      await value.binding.provider.details!("virtual", "buffer-1"),
    ).toMatchObject({ path: "/chosen/new.txt" });
    await value.binding.host.drafts.remove("virtual");
    expect(value.original.drafts.remove).not.toHaveBeenCalled();
  });
  it("saved documents expose recovery separately and explicit draft removal resets to saved text", async () => {
    const value = fixture("/chosen/new.txt");
    await value.binding.host.drafts.write(value.draft("pending"));
    expect(await value.binding.host.drafts.read("virtual")).toMatchObject({
      source: "pending",
      baseRevision: "base",
    });
    await value.binding.host.drafts.remove("virtual");
    expect(value.record().source).toBe("");
  });
});
