import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  native: false,
  save: vi.fn(),
  exportData: vi.fn(),
}));
vi.mock("../../src/lib/tauri-desktop", () => ({
  isTauri: () => platform.native,
  exportWithDialog: platform.save,
}));
vi.mock("../../src/lib/api", () => ({
  api: { export: { data: platform.exportData } },
}));
import {
  exportLocalJsonBackup,
  saveJsonBackup,
} from "../../src/lib/local-backup-export";

describe("cross-platform backup delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    platform.native = false;
    platform.save.mockReset();
    platform.exportData.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes the exact recovery snapshot and filename to the native dialog", async () => {
    platform.native = true;
    platform.save.mockResolvedValue("C:/backups/recovery.json");
    const data =
      '{"notes":[{"content":{"encrypted":{"ciphertext":"sealed"}}}]}';
    expect(await saveJsonBackup(data, "recovery.json")).toEqual({
      destination: "C:/backups/recovery.json",
      desktop: true,
    });
    expect(platform.save).toHaveBeenCalledWith(data, "recovery.json");
    expect(platform.exportData).not.toHaveBeenCalled();
  });

  it("treats cancelling the native dialog as cancellation, not success or failure", async () => {
    platform.native = true;
    platform.save.mockResolvedValue(null);
    expect(await saveJsonBackup("{}", "recovery.json")).toBeNull();
    platform.save.mockRejectedValue(new Error("write failed"));
    await expect(saveJsonBackup("{}", "recovery.json")).rejects.toThrow(
      "write failed",
    );
  });

  it("downloads the same snapshot in Web/PWA and releases the object URL after click", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: append },
    });
    vi.stubGlobal("window", { setTimeout });
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:backup");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    expect(await saveJsonBackup('{"pending":true}', "recovery.json")).toEqual({
      destination: "recovery.json",
      desktop: false,
    });
    expect(await (create.mock.calls[0][0] as Blob).text()).toBe(
      '{"pending":true}',
    );
    expect(anchor.download).toBe("recovery.json");
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:backup");
  });

  it("normal backup uses the same native delivery path", async () => {
    platform.native = true;
    platform.exportData.mockResolvedValue('{"notes":[]}');
    platform.save.mockResolvedValue("normal.json");
    await exportLocalJsonBackup();
    expect(platform.save).toHaveBeenCalledWith(
      '{"notes":[]}',
      expect.stringMatching(/^nine-rings-.*\.json$/),
    );
  });
});
