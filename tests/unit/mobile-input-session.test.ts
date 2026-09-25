import { expect, test } from "vitest";
import { MobileInputSession } from "../../src/lib/mobile-input-session";

test("touch and keyboard resize cannot reveal an unconfirmed old caret", () => {
  const session = new MobileInputSession();
  session.touch();
  session.request();
  expect(session.pending).toBe(true);
  expect(session.blocked).toBe(true);
  session.release();
  expect(session.blocked).toBe(false);
});
test("reading and selection suppress requests until real input/navigation", () => {
  const session = new MobileInputSession();
  for (const action of [() => session.read(), () => session.select()]) {
    action();
    session.request();
    expect(session.pending).toBe(false);
    expect(session.blocked).toBe(true);
    session.navigate();
    session.request();
    expect(session.blocked).toBe(false);
    expect(session.pending).toBe(true);
  }
});
test("composition defers reveal, and blur invalidates pending work", () => {
  const session = new MobileInputSession();
  session.input(true);
  session.request();
  expect(session.blocked).toBe(true);
  session.input(false);
  expect(session.blocked).toBe(false);
  session.blur();
  expect(session.pending).toBe(false);
  expect(session.phase).toBe("idle");
});
