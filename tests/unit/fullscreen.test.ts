import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isFullscreen: vi.fn(),
  dispatchEvent: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: mocks.isFullscreen }),
}));
import {
  FULLSCREEN_WILL_CHANGE_EVENT,
  toggleTauriFullscreen,
} from "../../src/lib/fullscreen";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "CustomEvent",
    class extends Event {
      detail: unknown;
      constructor(type: string, options: CustomEventInit) {
        super(type);
        this.detail = options.detail;
      }
    },
  );
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {},
    dispatchEvent: mocks.dispatchEvent,
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])(
  "captures the reading anchor before the native transition (fullscreen=%s)",
  async (fullscreen) => {
    mocks.isFullscreen.mockResolvedValue(fullscreen);
    mocks.invoke.mockImplementation(async () => {
      const event = mocks.dispatchEvent.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe(FULLSCREEN_WILL_CHANGE_EVENT);
      expect(event.detail).toEqual({ fullscreen: !fullscreen });
    });
    expect(await toggleTauriFullscreen()).toBe(!fullscreen);
    expect(mocks.invoke).toHaveBeenCalledWith("set_window_fullscreen", {
      fullscreen: !fullscreen,
    });
  },
);

it("propagates native errors so callers do not report a successful transition", async () => {
  mocks.isFullscreen.mockResolvedValue(false);
  mocks.invoke.mockRejectedValue(new Error("transition failed"));
  await expect(toggleTauriFullscreen()).rejects.toThrow("transition failed");
});

it("does not invoke the native transition in a browser", async () => {
  vi.stubGlobal("window", {});
  expect(await toggleTauriFullscreen()).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
