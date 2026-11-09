import { expect, it, vi } from "vitest";
import {
  saveLocalSource,
  type LocalSourceSavePorts,
} from "../../src/lib/local-files/source-save";
import {
  localSourceCopy,
  downloadLocalSource,
} from "../../src/lib/local-files/source-download";
import {
  MAX_SOURCE_BYTES,
  type LocalFileSnapshot,
} from "../../src/lib/local-files/file-model";
const base: LocalFileSnapshot = {
  source: "old",
  revision: "r1",
  bom: true,
  lineEnding: "crlf",
  size: 3,
  modifiedMs: 1,
};
function fixture() {
  let text = "new";
  const saved = { ...base, source: "new", revision: "r2" };
  const ports = {
    submitted: text,
    base,
    currentSource: () => text,
    write: vi.fn(async () => saved),
    committed: vi.fn(),
    keepDraft: vi.fn(async () => {}),
    clearDraft: vi.fn(async () => {}),
  } satisfies LocalSourceSavePorts;
  return {
    ports,
    saved,
    edit: (next: string) => {
      text = next;
    },
  };
}
it("rebases the session before clearing its draft, using the expected disk revision", async () => {
  const { ports, saved } = fixture();
  ports.clearDraft.mockImplementationOnce(async () => {
    expect(ports.committed).toHaveBeenCalledWith(saved);
  });
  const result = await saveLocalSource(ports);
  expect(ports.write).toHaveBeenCalledWith("new", base);
  expect(ports.keepDraft).not.toHaveBeenCalled();
  expect(result).toEqual({ saved, clean: true, recoveryIssue: "" });
});
it("keeps edits made while the disk write is pending against the new base", async () => {
  const { ports, saved, edit } = fixture();
  ports.write.mockImplementationOnce(async () => {
    edit("newer");
    return saved;
  });
  const result = await saveLocalSource(ports);
  expect(ports.keepDraft).toHaveBeenCalledWith("newer", saved);
  expect(ports.clearDraft).not.toHaveBeenCalled();
  expect(result.clean).toBe(false);
});
it("rechecks editing after an asynchronous draft removal instead of losing the new edit", async () => {
  const { ports, saved, edit } = fixture();
  ports.clearDraft.mockImplementationOnce(async () => {
    edit("typed during cleanup");
  });
  expect((await saveLocalSource(ports)).clean).toBe(false);
  expect(ports.keepDraft).toHaveBeenCalledWith("typed during cleanup", saved);
});
it("reports recovery failure after a confirmed write without misreporting a failed disk save", async () => {
  const { ports } = fixture();
  ports.clearDraft.mockRejectedValueOnce(new Error("quota"));
  expect(await saveLocalSource(ports)).toMatchObject({
    clean: true,
    recoveryIssue: expect.stringContaining("quota"),
  });
  expect(ports.write).toHaveBeenCalledOnce();
  expect(ports.committed).toHaveBeenCalledOnce();
});
it("leaves the baseline and recovery draft untouched when revision validation fails", async () => {
  const { ports } = fixture();
  ports.write.mockRejectedValueOnce(new Error("STALE_REVISION"));
  await expect(saveLocalSource(ports)).rejects.toThrow("STALE_REVISION");
  expect(ports.committed).not.toHaveBeenCalled();
  expect(ports.clearDraft).not.toHaveBeenCalled();
  expect(ports.keepDraft).not.toHaveBeenCalled();
});
it("bounds continuously changing recovery settlement and reports that editing remains unsaved", async () => {
  const { ports, edit } = fixture();
  let next = 0;
  edit("during save");
  ports.keepDraft.mockImplementation(async () => {
    edit(`next ${++next}`);
  });
  expect(await saveLocalSource(ports)).toMatchObject({
    clean: false,
    recoveryIssue: expect.stringContaining("持续变化"),
  });
  expect(ports.keepDraft).toHaveBeenCalledTimes(3);
  expect(ports.write).toHaveBeenCalledOnce();
});
it("exports the original BOM and line-ending convention within the byte budget", () => {
  expect(localSourceCopy("a\nb\r\nc", base)).toBe("\ufeffa\r\nb\r\nc");
  expect(localSourceCopy("a\nb", { bom: false, lineEnding: "cr" })).toBe(
    "a\rb",
  );
  expect(localSourceCopy("a\r\nb", null)).toBe("a\nb");
  expect(localSourceCopy("a\nb", { bom: false, lineEnding: "mixed" })).toBe(
    "a\nb",
  );
  expect(localSourceCopy("a".repeat(MAX_SOURCE_BYTES), null)).toHaveLength(
    MAX_SOURCE_BYTES,
  );
  expect(() => localSourceCopy("a".repeat(MAX_SOURCE_BYTES), base)).toThrow(
    "4 MiB",
  );
});

it("returns the confirmed receipt if host settlement fails, without offering a clean exit", async () => {
  const { ports, saved } = fixture();
  ports.committed.mockImplementationOnce(() => {
    throw new Error("view failed");
  });
  expect(await saveLocalSource(ports)).toEqual({
    saved,
    clean: false,
    recoveryIssue: expect.stringContaining("view failed"),
  });
  expect(ports.write).toHaveBeenCalledOnce();
});

it("releases an export URL even when the browser rejects the download click", () => {
  let release!: () => void;
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:test-export");
  vi.stubGlobal("window", {
    setTimeout: (callback: () => void) => {
      release = callback;
    },
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      click() {
        throw new Error("blocked download");
      },
    }),
  });
  try {
    expect(() => downloadLocalSource("a.c", "code", base)).toThrow(
      "blocked download",
    );
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    release();
    expect(revoke).toHaveBeenCalledWith("blob:test-export");
  } finally {
    vi.unstubAllGlobals();
    revoke.mockRestore();
    create.mockRestore();
  }
});
