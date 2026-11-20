import { expect, it, vi } from "vitest";
import { checkpointLocalSource } from "../../src/lib/local-files/source-checkpoint";
import type { LocalFileSnapshot } from "../../src/lib/local-files/file-model";

const base: LocalFileSnapshot = {
  source: "original",
  revision: "r1",
  bom: true,
  lineEnding: "crlf",
  size: 8,
  modifiedMs: 1,
};

function fixture() {
  const current = {
    source: base.source,
    base: base as LocalFileSnapshot | null,
  };
  const drafts = {
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const isSaving = vi.fn(() => false);
  const ports = {
    identity: "root:note.md",
    drafts,
    read: () => current,
    isSaving,
  };
  return { current, drafts, isSaving, ports };
}

it("writes edits that arrived during clean draft removal", async () => {
  const { current, drafts, ports } = fixture();
  drafts.remove.mockImplementationOnce(async () => {
    current.source = "new edit";
  });
  await checkpointLocalSource(ports);
  expect(drafts.remove).toHaveBeenCalledWith(ports.identity);
  expect(drafts.write).toHaveBeenCalledWith({
    identity: ports.identity,
    source: "new edit",
    baseSource: base.source,
    baseRevision: base.revision,
    bom: true,
    lineEnding: "crlf",
    savedAt: expect.any(Number),
  });
});

it("uses the latest disk baseline when saving finishes during a checkpoint", async () => {
  const { current, drafts, ports } = fixture();
  current.source = "submitted";
  drafts.write.mockImplementationOnce(async () => {
    current.base = { ...base, source: "submitted", revision: "r2" };
    current.source = "next edit";
  });
  await checkpointLocalSource(ports);
  expect(drafts.write).toHaveBeenLastCalledWith(
    expect.objectContaining({ baseRevision: "r2", source: "next edit" }),
  );
});

it("blocks leaving while save is active or draft persistence fails", async () => {
  const { drafts, isSaving, ports } = fixture();
  isSaving.mockReturnValueOnce(true);
  await expect(checkpointLocalSource(ports)).rejects.toThrow("正在保存");
  expect(drafts.remove).not.toHaveBeenCalled();
  drafts.remove.mockImplementationOnce(async () => {
    isSaving.mockReturnValueOnce(true);
  });
  await expect(checkpointLocalSource(ports)).rejects.toThrow("正在保存");
  drafts.remove.mockRejectedValueOnce(new Error("quota"));
  await expect(checkpointLocalSource(ports)).rejects.toThrow("quota");
});

it("retains a clean untitled document and skips missing baselines", async () => {
  const { current, drafts, ports } = fixture();
  await checkpointLocalSource({ ...ports, retainClean: true });
  expect(drafts.write).toHaveBeenCalledOnce();
  expect(drafts.remove).not.toHaveBeenCalled();
  current.base = null;
  await checkpointLocalSource(ports);
  expect(drafts.write).toHaveBeenCalledOnce();
  expect(drafts.remove).not.toHaveBeenCalled();
});

it("bounds retries and propagates failures before writing any draft", async () => {
  const { current, drafts, ports } = fixture();
  await expect(
    checkpointLocalSource({
      ...ports,
      read: () => {
        throw new Error("pending Markdown could not be read");
      },
    }),
  ).rejects.toThrow("pending Markdown");
  expect(drafts.remove).not.toHaveBeenCalled();
  current.source = "editing";
  drafts.write.mockImplementation(async () => {
    current.source += "!";
  });
  await expect(checkpointLocalSource(ports)).rejects.toThrow("持续变化");
  expect(drafts.write).toHaveBeenCalledTimes(3);
});
