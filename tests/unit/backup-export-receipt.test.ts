import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBackupExportReceipt,
  recordBackupExport,
} from "../../src/lib/backup-export-receipt";
const mocks = vi.hoisted(() => ({
  data: vi.fn(),
  desktop: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../src/lib/api", () => ({ api: { export: { data: mocks.data } } }));
vi.mock("../../src/lib/tauri-desktop", () => ({
  isTauri: mocks.desktop,
  exportWithDialog: mocks.save,
}));
import { exportLocalJsonBackup } from "../../src/lib/local-backup-export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("backup export delivery receipts", () => {
  it("records only time and observed delivery type", () => {
    let saved = "";
    const storage = {
      setItem: (_key: string, value: string) => {
        saved = value;
      },
      getItem: () => saved,
    };
    expect(recordBackupExport(false, storage)).toBe(true);
    expect(readBackupExportReceipt(storage)?.delivery).toBe(
      "download-requested",
    );
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual(["at", "delivery"]);
    recordBackupExport(true, storage);
    expect(readBackupExportReceipt(storage)?.delivery).toBe("file-saved");
  });
  it("rejects malformed receipts and tolerates denied storage", () => {
    for (const text of [
      "{",
      "null",
      '{"at":"invalid","delivery":"file-saved"}',
      '{"at":"2026-09-10","delivery":"uploaded"}',
    ]) {
      expect(readBackupExportReceipt({ getItem: () => text })).toBeNull();
    }
    expect(
      recordBackupExport(true, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
  });
  it("does not record cancellation, serialization failure or file write failure", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    mocks.desktop.mockReturnValue(true);
    mocks.data.mockResolvedValue("{}");
    mocks.save.mockResolvedValue(null);
    expect(await exportLocalJsonBackup()).toBeNull();
    mocks.save.mockRejectedValueOnce(new Error("disk"));
    await expect(exportLocalJsonBackup()).rejects.toThrow("disk");
    mocks.data.mockRejectedValueOnce(new Error("snapshot"));
    await expect(exportLocalJsonBackup()).rejects.toThrow("snapshot");
    expect(storage.setItem).not.toHaveBeenCalled();
    mocks.save.mockResolvedValue("private/backup.json");
    expect(await exportLocalJsonBackup()).toEqual({
      desktop: true,
      destination: "private/backup.json",
    });
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem.mock.calls[0][1]).not.toContain("private");
  });
});
