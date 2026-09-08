import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  watchPwaUpdates,
  type PwaUpdateStatus,
} from "../../src/lib/pwa-updates";

class Worker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

describe("PWA update lifecycle", () => {
  let registration: EventTarget & {
    installing: Worker | null;
    waiting: Worker | null;
    update: ReturnType<typeof vi.fn>;
  };
  let container: EventTarget & {
    controller: Worker | null;
    register: ReturnType<typeof vi.fn>;
  };
  let browser: EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };
  let doc: EventTarget & { visibilityState: string };
  let network: { onLine: boolean; serviceWorker: typeof container };
  let status: PwaUpdateStatus;
  let updater: ReturnType<typeof watchPwaUpdates>;
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(1);
  };
  const start = () => {
    updater = watchPwaUpdates((value) => {
      status = value;
    });
  };
  const installed = (worker: Worker) => {
    registration.installing = null;
    registration.waiting = worker;
    worker.change("installed");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    registration = Object.assign(new EventTarget(), {
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    });
    container = Object.assign(new EventTarget(), {
      controller: new Worker(),
      register: vi.fn().mockResolvedValue(registration),
    });
    browser = Object.assign(new EventTarget(), {
      location: { reload: vi.fn() },
    });
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    network = { onLine: true, serviceWorker: container };
    vi.stubGlobal("navigator", network);
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", doc);
  });
  afterEach(() => {
    updater?.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("observes an installer that predates register resolution", async () => {
    const worker = new Worker();
    registration.installing = worker;
    start();
    await settle();
    expect(status.checking).toBe(true);
    expect(container.register).toHaveBeenCalledWith("/sw.js", {
      updateViaCache: "none",
    });
    installed(worker);
    await settle();
    expect(status).toMatchObject({
      checking: false,
      available: true,
      error: null,
    });
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it("waits for download and activation before an explicit reload", async () => {
    start();
    await settle();
    const worker = new Worker();
    registration.update.mockImplementation(async () => {
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
    });
    const apply = updater.apply();
    await settle();
    expect(worker.postMessage).not.toHaveBeenCalled();
    installed(worker);
    await settle();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(browser.location.reload).not.toHaveBeenCalled();
    container.controller = worker;
    container.dispatchEvent(new Event("controllerchange"));
    await apply;
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });

  it("reports installation failure and retries on reconnect without clearing data", async () => {
    const worker = new Worker();
    registration.installing = worker;
    start();
    await settle();
    registration.installing = null;
    worker.change("redundant");
    await settle();
    expect(status.error).toContain("安装失败");
    browser.dispatchEvent(new Event("online"));
    await settle();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(status.error).toBeNull();
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it("does not surface redundant installers that are not part of this tab's update attempt", async () => {
    const worker = new Worker();
    start();
    await settle();

    expect(status.available).toBe(false);
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    await settle();

    worker.change("redundant");
    await settle();

    expect(status.error).toBeNull();
  });

  it("coalesces checks, polls only while visible, and throttles focus events", async () => {
    start();
    await settle();
    browser.dispatchEvent(new Event("focus"));
    browser.dispatchEvent(new Event("pageshow"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(300_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    browser.dispatchEvent(new Event("focus"));
    await settle();
    expect(registration.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it("does not refresh unsaved tabs when another tab activates an update", async () => {
    start();
    await settle();
    container.controller = new Worker();
    container.dispatchEvent(new Event("controllerchange"));
    expect(status.available).toBe(true);
    expect(browser.location.reload).not.toHaveBeenCalled();
    await updater.apply();
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });

  it("does not advertise the first installation as an update", async () => {
    container.controller = null;
    const worker = new Worker();
    registration.installing = worker;
    start();
    await settle();
    registration.installing = null;
    worker.change("activated");
    container.controller = worker;
    container.dispatchEvent(new Event("controllerchange"));
    await settle();
    expect(status.available).toBe(false);
  });

  it("handles offline startup and retries a failed registration", async () => {
    network.onLine = false;
    start();
    expect(status.error).toContain("离线");
    expect(container.register).not.toHaveBeenCalled();
    network.onLine = true;
    container.register.mockRejectedValueOnce(new Error("network"));
    await updater.check();
    expect(status.error).toContain("network");
    await updater.check();
    expect(status).toMatchObject({ checked: true, error: null });
  });

  it("times out activation without reloading, allowing a later retry", async () => {
    const worker = new Worker();
    registration.waiting = worker;
    start();
    await settle();
    const result = expect(updater.apply()).rejects.toThrow("等待超时");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it("times out hung update requests and removes listeners on cleanup", async () => {
    registration.update.mockImplementation(() => new Promise(() => {}));
    start();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(status.checking).toBe(false);
    expect(status.error).toContain("超时");
    updater.dispose();
    const calls = registration.update.mock.calls.length;
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(registration.update).toHaveBeenCalledTimes(calls);
  });
});
