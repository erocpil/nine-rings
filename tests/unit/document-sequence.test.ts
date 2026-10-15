import { describe, expect, it, vi } from "vitest";
import {
  adjacentDocuments,
  DocumentNavigationRegistry,
} from "../../src/lib/plugin-system/document-navigation";
import { PluginRuntime } from "../../src/lib/plugin-system/runtime";
const items = [
  { id: "a", title: "A", scope: "virtual:group-1" },
  { id: "outside", title: "B", scope: "virtual:group-2" },
  { id: "c", title: "C", scope: "virtual:group-1" },
];
describe("document sequence", () => {
  it("preserves provider order, respects logical scopes and never wraps", () => {
    expect(adjacentDocuments(items, "a")).toEqual({
      previous: null,
      next: items[2],
    });
    expect(adjacentDocuments(items, "c")).toEqual({
      previous: items[0],
      next: null,
    });
    expect(adjacentDocuments(items, "outside")).toEqual({
      previous: null,
      next: null,
    });
    expect(adjacentDocuments(items, "missing")).toEqual({
      previous: null,
      next: null,
    });
    expect(adjacentDocuments([...items].reverse(), "c").next?.id).toBe("a");
  });
  it("revalidates adjacent targets and disposes registrations on disable", async () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const owner = runtime.activate("test.navigation", ["views.present"]);
    const registry = new DocumentNavigationRegistry(runtime);
    const open = vi.fn(async () => {});
    registry.register(owner, "words", { list: async () => items, open });
    await registry.openAdjacent("words", "a", "c");
    expect(open).toHaveBeenCalledWith("c", "a");
    await expect(
      registry.openAdjacent("words", "a", "outside"),
    ).rejects.toMatchObject({ code: "STALE_TARGET" });
    runtime.setEnabled(false);
    await expect(registry.neighbors("words", "a")).rejects.toMatchObject({
      code: "PLUGIN_DISABLED",
    });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("rejects late results after plugin reload", async () => {
    const runtime = new PluginRuntime();
    runtime.setEnabled(true);
    const registry = new DocumentNavigationRegistry(runtime);
    const owner = runtime.activate("test.navigation", ["views.present"]);
    let finish!: (value: typeof items) => void;
    registry.register(owner, "words", {
      list: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      open: async () => {},
    });
    const pending = registry.neighbors("words", "a");
    const replacement = runtime.activate("test.navigation", ["views.present"]);
    registry.register(replacement, "words", {
      list: async () => [],
      open: async () => {},
    });
    finish(items);
    await expect(pending).rejects.toMatchObject({ code: "STALE_TARGET" });
  });
});
