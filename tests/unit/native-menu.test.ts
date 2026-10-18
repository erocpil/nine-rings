import { afterEach, describe, expect, it, vi } from "vitest";
import catalog from "../../src/lib/native-menu-catalog.json";
import {
  blockNativeMenu,
  nativeMenuSnapshot,
  registerNativeMenuActions,
  runNativeMenuAction,
} from "../../src/lib/native-menu-registry";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  blockNativeMenu(false);
});
describe("macOS 菜单命令", () => {
  it("disabled/blocked actions cannot execute, including forged or unknown IDs", () => {
    const run = vi.fn();
    cleanup.push(
      registerNativeMenuActions(
        {},
        { edit: { run }, readonly: { run, enabled: false } },
      ),
    );
    runNativeMenuAction("readonly");
    runNativeMenuAction("unknown");
    runNativeMenuAction("toString");
    expect(run).not.toHaveBeenCalled();
    blockNativeMenu(true);
    runNativeMenuAction("edit");
    expect(nativeMenuSnapshot().every((item) => !item.enabled)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    blockNativeMenu(false);
    runNativeMenuAction("edit");
    expect(run).toHaveBeenCalledOnce();
  });
  it("keeps latest handlers/checks and does not erase a replacement with stale cleanup", () => {
    const owner = {},
      old = vi.fn(),
      latest = vi.fn();
    const stale = registerNativeMenuActions(owner, { source: { run: old } });
    cleanup.push(
      registerNativeMenuActions(owner, {
        source: { run: latest, checked: true },
      }),
    );
    stale();
    runNativeMenuAction("source");
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(nativeMenuSnapshot()).toContainEqual({
      id: "source",
      enabled: true,
      checked: true,
    });
  });
  it("removing a retained view removes its actions", () => {
    const hidden = vi.fn(),
      active = vi.fn();
    const remove = registerNativeMenuActions({}, { bold: { run: hidden } });
    remove();
    cleanup.push(registerNativeMenuActions({}, { bold: { run: active } }));
    runNativeMenuAction("bold");
    expect(hidden).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledOnce();
  });
  it("catalog has unique commands and never replaces native quit, close or clipboard responders", () => {
    const ids: string[] = [];
    const visit = (entries: { id?: string; items?: unknown[] }[]) =>
      entries.forEach((entry) => {
        if (entry.id) ids.push(entry.id);
        if (entry.items) visit(entry.items as typeof entries);
      });
    visit(catalog);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.some((id) => /quit|close|copy|paste/.test(id))).toBe(false);
  });
});
