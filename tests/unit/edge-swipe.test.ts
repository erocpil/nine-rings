import { afterEach, describe, expect, it, vi } from "vitest";
import { bindEdgeSwipe, horizontalSwipeDirection, isWithinSwipeEdge } from "../../src/lib/edge-swipe";

describe("shared edge swipe rules", () => {
  it.each([0, 1, 12, 24, 29.9])("accepts an edge inset of %s px", (inset) => {
    expect(isWithinSwipeEdge(inset)).toBe(true);
  });

  it.each([-1, 30, 40, 44])("rejects an edge inset of %s px", (inset) => {
    expect(isWithinSwipeEdge(inset)).toBe(false);
  });

  it.each([1, -1])("uses identical distance and direction rules on side %s", (sign) => {
    const direction = sign === 1 ? "right" : "left";
    expect(horizontalSwipeDirection(sign * 60, 0)).toBeNull();
    expect(horizontalSwipeDirection(sign * 61, 0)).toBe(direction);
    expect(horizontalSwipeDirection(sign * 100, 80)).toBe(direction);
    expect(horizontalSwipeDirection(sign * 100, -100)).toBe(direction);
    expect(horizontalSwipeDirection(sign * 80, 100)).toBeNull();
  });
});

describe("edge swipe lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const host = new EventTarget();
    const viewport = new EventTarget();
    vi.stubGlobal("window", viewport);
    vi.stubGlobal("Element", class {});
    const run = vi.fn();
    const cleanup = bindEdgeSwipe(host as unknown as Window, () => ({ direction: "right", run }));
    const touch = (x: number, y = 0, identifier = 1) => ({ clientX: x, clientY: y, identifier });
    const send = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches, cancelable = true) => {
      const event = new Event(type, { cancelable });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      host.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return { host, viewport, run, cleanup, touch, send };
  }

  it.each(["multitouch", "cancel", "blur", "cleanup", "identifier", "native-scroll"])(
    "does not complete a gesture interrupted by %s",
    (reason) => {
      const { viewport, run, cleanup, touch, send } = setup();
      send("touchstart", [touch(0)]);
      expect(send("touchmove", [touch(8, 3)])).toBe(true);
      if (reason === "multitouch") send("touchstart", [touch(8), touch(10, 0, 2)]);
      if (reason === "cancel") send("touchcancel", [], [touch(8)]);
      if (reason === "blur") viewport.dispatchEvent(new Event("blur"));
      if (reason === "cleanup") cleanup();
      if (reason === "identifier") send("touchmove", [touch(10, 0, 2)]);
      if (reason === "native-scroll") send("touchmove", [touch(10)], [touch(10)], false);
      send("touchend", [], [touch(100)]);
      expect(run).not.toHaveBeenCalled();
      cleanup();
    },
  );

  it("does not open a panel on taps, but recovers for the next swipe", () => {
    const { run, cleanup, touch, send } = setup();
    send("touchstart", [touch(0)]);
    expect(send("touchend", [], [touch(0)])).toBe(false);
    expect(run).not.toHaveBeenCalled();
    send("touchstart", [touch(0)]);
    expect(send("touchmove", [touch(8, 3)])).toBe(true);
    expect(send("touchmove", [touch(80, 120)])).toBe(true);
    send("touchend", [], [touch(80, 120)]);
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
