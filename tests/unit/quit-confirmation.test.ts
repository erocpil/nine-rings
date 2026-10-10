import { expect, it, vi } from "vitest";
import { createQuitConfirmation } from "../../src/lib/quit-confirmation";

function setup() {
  let time = 0;
  const calls: string[] = [];
  const actions = {
    now: () => time,
    hint: vi.fn(),
    clear: vi.fn(),
    progress: vi.fn(),
    save: vi.fn(async () => {
      calls.push("save");
    }),
    quit: vi.fn(async () => {
      calls.push("quit");
    }),
    error: vi.fn(),
  };
  return {
    actions,
    calls,
    confirmation: createQuitConfirmation(actions),
    time: (value: number) => {
      time = value;
    },
  };
}

it("first press hints; second press saves before exiting", async () => {
  const s = setup();
  await s.confirmation.request();
  expect(s.actions.hint).toHaveBeenCalledOnce();
  expect(s.calls).toEqual([]);
  s.time(1000);
  await s.confirmation.request();
  expect(s.actions.clear).toHaveBeenCalledOnce();
  expect(s.calls).toEqual(["save", "quit"]);
});

it("expired confirmation starts a new window instead of quitting", async () => {
  const s = setup();
  await s.confirmation.request();
  s.time(2000);
  await s.confirmation.request();
  expect(s.actions.hint).toHaveBeenCalledTimes(2);
  expect(s.calls).toEqual([]);
  s.time(2500);
  await s.confirmation.request();
  expect(s.calls).toEqual(["save", "quit"]);
});

it("leaving the application cancels an armed confirmation", async () => {
  const s = setup();
  await s.confirmation.request();
  s.confirmation.reset();
  s.time(200);
  await s.confirmation.request();
  expect(s.calls).toEqual([]);
  expect(s.actions.hint).toHaveBeenCalledTimes(2);
});

it("save failure keeps the application open and requires confirmation again", async () => {
  const s = setup();
  const error = new Error("disk full");
  s.actions.save.mockRejectedValueOnce(error);
  await s.confirmation.request();
  await s.confirmation.request();
  expect(s.actions.quit).not.toHaveBeenCalled();
  expect(s.actions.error).toHaveBeenCalledWith(error);
  await s.confirmation.request();
  expect(s.actions.hint).toHaveBeenCalledTimes(2);
});

it("repeated requests during pending save do not start duplicate exits", async () => {
  const s = setup();
  let finish!: () => void;
  s.actions.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await s.confirmation.request();
  const saving = s.confirmation.request();
  await s.confirmation.request();
  await s.confirmation.request();
  expect(s.actions.save).toHaveBeenCalledOnce();
  expect(s.actions.quit).not.toHaveBeenCalled();
  finish();
  await saving;
  expect(s.actions.quit).toHaveBeenCalledOnce();
});

it("reports saving and saved/exiting phases without a fixed delay", async () => {
  const s = setup();
  let saved!: () => void;
  let exited!: () => void;
  s.actions.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
  );
  s.actions.quit.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        exited = resolve;
      }),
  );
  await s.confirmation.request();
  const request = s.confirmation.request();
  expect(s.actions.progress.mock.calls).toEqual([["saving"]]);
  expect(s.actions.clear).not.toHaveBeenCalled();
  saved();
  await Promise.resolve();
  expect(s.actions.progress.mock.calls).toEqual([["saving"], ["exiting"]]);
  expect(s.actions.quit).toHaveBeenCalledOnce();
  expect(s.actions.clear).not.toHaveBeenCalled();
  exited();
  await request;
  expect(s.actions.clear).toHaveBeenCalledOnce();
});

it("does not announce successful save or exit when saving fails", async () => {
  const s = setup();
  s.actions.save.mockRejectedValueOnce(new Error("disk full"));
  await s.confirmation.request();
  await s.confirmation.request();
  expect(s.actions.progress.mock.calls).toEqual([["saving"]]);
  expect(s.actions.quit).not.toHaveBeenCalled();
  expect(s.actions.error).toHaveBeenCalledOnce();
});
