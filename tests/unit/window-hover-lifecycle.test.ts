import { afterEach, expect, it, vi } from "vitest";
import { watchWindowHoverDismiss } from "../../src/lib/window-hover-lifecycle";

afterEach(() => vi.unstubAllGlobals());

it("discards foreground hover on blur, hide and page departure without reopening on focus", () => {
  const host = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", page);
  const dismiss = vi.fn();
  const stop = watchWindowHoverDismiss(dismiss);
  host.dispatchEvent(new Event("blur"));
  expect(dismiss).toHaveBeenCalledTimes(1);
  host.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  expect(dismiss).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  host.dispatchEvent(new Event("pagehide"));
  expect(dismiss).toHaveBeenCalledTimes(3);
  stop();
  host.dispatchEvent(new Event("blur"));
  host.dispatchEvent(new Event("pagehide"));
  page.dispatchEvent(new Event("visibilitychange"));
  expect(dismiss).toHaveBeenCalledTimes(3);
});
