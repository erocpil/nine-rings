import { expect, it, vi } from "vitest";
import {
  installWorkbenchClose,
  type WorkbenchCloseTransport,
} from "../../src/apps/file-workbench/native-lifecycle";
import { exportLocalSource } from "../../src/lib/local-files/source-download";
function fixture() {
  let event = () => {};
  const unlisten = vi.fn();
  const transport: WorkbenchCloseTransport = {
    listen: vi.fn(async (callback) => {
      event = callback;
      return unlisten;
    }),
    ready: vi.fn(async () => {}),
    confirm: vi.fn(async () => {}),
  };
  const error = vi.fn(),
    request = vi.fn<(confirm: () => void) => void>();
  return { transport, unlisten, request, error, event: () => event() };
}
it("subscribes before ready; native close waits for editor confirmation and supports cancellation", async () => {
  const f = fixture();
  const dispose = await installWorkbenchClose(f.request, f.error, f.transport);
  expect(
    vi.mocked(f.transport.listen).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(f.transport.ready).mock.invocationCallOrder[0]);
  f.event();
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.transport.confirm).not.toHaveBeenCalled();
  // The editor cancels the first request, then confirms the next request.
  f.event();
  f.request.mock.calls[1][0]();
  expect(f.transport.confirm).toHaveBeenCalledOnce();
  dispose();
  f.event();
  f.request.mock.calls[0][0]();
  expect(f.unlisten).toHaveBeenCalledOnce();
  expect(f.transport.confirm).toHaveBeenCalledOnce();
  expect(f.request).toHaveBeenCalledTimes(2);
});
it("failed ready removes listener and cannot confirm late requests", async () => {
  const f = fixture();
  vi.mocked(f.transport.ready).mockRejectedValue(new Error("not ready"));
  await expect(
    installWorkbenchClose(f.request, f.error, f.transport),
  ).rejects.toThrow("not ready");
  expect(f.unlisten).toHaveBeenCalledOnce();
  f.event();
  expect(f.request).not.toHaveBeenCalled();
});
it("failed native confirmation is visible and can be retried", async () => {
  const f = fixture();
  vi.mocked(f.transport.confirm).mockRejectedValueOnce(new Error("IPC failed"));
  await installWorkbenchClose(f.request, f.error, f.transport);
  f.event();
  f.request.mock.calls[0][0]();
  await vi.waitFor(() =>
    expect(f.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "IPC failed" }),
    ),
  );
  f.event();
  f.request.mock.calls[1][0]();
  expect(f.transport.confirm).toHaveBeenCalledTimes(2);
});
it("native copy success, cancellation and failure do not fall back to browser downloads", async () => {
  const save = vi.fn(async () => "saved" as const);
  await expect(exportLocalSource("test.c", "text", null, save)).resolves.toBe(
    true,
  );
  expect(save).toHaveBeenCalledWith("test.c", "text", null);
  await expect(
    exportLocalSource("test.c", "text", null, async () => "cancelled"),
  ).resolves.toBe(false);
  await expect(
    exportLocalSource("test.c", "text", null, async () => {
      throw new Error("disk full");
    }),
  ).rejects.toThrow("disk full");
});
