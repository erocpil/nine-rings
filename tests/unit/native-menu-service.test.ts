import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNativeMenuActions } from "../../src/lib/native-menu-registry";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  offMenu: vi.fn(),
  offFocus: vi.fn(),
  action: null as null | ((event: { payload: string }) => void),
  focus: null as null | ((event: { payload: boolean }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: typeof mocks.action) => {
    mocks.action = handler;
    return mocks.offMenu;
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: async () => true,
    onFocusChanged: async (handler: typeof mocks.focus) => {
      mocks.focus = handler;
      return mocks.offFocus;
    },
  }),
}));
import { startNativeMenuService } from "../../src/lib/native-menu-service";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.clearAllMocks();
});
describe("native menu bridge", () => {
  it("skips unchanged state IPC, uses latest handlers and disables an unfocused main window", async () => {
    const owner = {},
      first = vi.fn(),
      latest = vi.fn();
    cleanups.push(registerNativeMenuActions(owner, { test: { run: first } }));
    const stop = await startNativeMenuService();
    cleanups.push(stop);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    cleanups.push(registerNativeMenuActions(owner, { test: { run: latest } }));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    mocks.action!({ payload: "test" });
    await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    mocks.focus!({ payload: false });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith("update_native_menu", {
        states: [{ id: "test", enabled: false, checked: false }],
      }),
    );
    mocks.action!({ payload: "test" });
    await Promise.resolve();
    expect(latest).toHaveBeenCalledOnce();
    stop();
    expect(mocks.offMenu).toHaveBeenCalledOnce();
    expect(mocks.offFocus).toHaveBeenCalledOnce();
  });
});
