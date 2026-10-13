import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { imageDirectoryMonitor } from "../../src/lib/image-library/directory-monitor";
import {
  imageDirectoryService,
  type ImageNode,
} from "../../src/lib/image-library/directory-service";
import { imageResourceCache } from "../../src/lib/image-library/resource-cache";
import {
  imageLibrarySession,
  resetImageLibrarySession,
  selectImage,
} from "../../src/lib/image-library/session";
import { imageFileChange } from "../../src/lib/image-library/file-changes";
const node = (id: string, modified = 1): ImageNode => ({
  id,
  name: id,
  directory: false,
  size: 10,
  modified,
});
const image = (id: string) => ({
  src: "",
  name: id,
  rootId: "root",
  nodeId: id,
});
let changed!: () => void;
const stop = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  Object.defineProperty(window, "setTimeout", { value: setTimeout });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  imageDirectoryMonitor.reset();
  resetImageLibrarySession();
  stop.mockReset();
  vi.spyOn(imageDirectoryService, "watch").mockImplementation(
    async (_root, _path, callback) => {
      changed = callback;
      return stop;
    },
  );
  vi.spyOn(imageDirectoryService, "list").mockResolvedValue({
    nodes: [node("a.png"), node("b.png")],
    next: null,
  });
  vi.spyOn(imageDirectoryService, "stat").mockRejectedValue(
    new Error("文件已移动或不可访问"),
  );
  vi.spyOn(imageResourceCache, "invalidate");
  imageLibrarySession.directories.set("root:", {
    open: true,
    page: { nodes: [node("a.png"), node("b.png")], next: null },
  });
});
afterEach(() => {
  imageDirectoryMonitor.reset();
  resetImageLibrarySession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("shares native watches, coalesces events and invalidates only changed/deleted files", async () => {
  const update = vi.fn();
  const error = vi.fn();
  const first = imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: update,
    error,
  });
  const second = imageDirectoryMonitor.subscribe("root", "", {
    active: false,
    changed: vi.fn(),
    error,
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.watch).toHaveBeenCalledTimes(1);
  vi.mocked(imageDirectoryService.list).mockResolvedValue({
    nodes: [node("a.png", 2), node("c.png")],
    next: null,
  });
  for (let i = 0; i < 10; i++) changed();
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(2);
  expect(imageDirectoryService.list).toHaveBeenLastCalledWith(
    "root",
    "",
    0,
    false,
  );
  expect(imageFileChange(image("a.png")).revision).toBe(1);
  expect(imageFileChange(image("b.png")).missing).toBe(true);
  expect(imageResourceCache.invalidate).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  first();
  expect(stop).not.toHaveBeenCalled();
  second();
  expect(stop).toHaveBeenCalledTimes(1);
});
it("polls only visible active browser directories and checks when focus returns", async () => {
  vi.mocked(imageDirectoryService.watch).mockResolvedValue(null);
  const unsubscribe = imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: vi.fn(),
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(10250);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(3);
  unsubscribe();
  await vi.advanceTimersByTimeAsync(20000);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(3);
});
it("keeps the loaded page range and does not mistake shifted entries for deletion", async () => {
  const nodes = Array.from({ length: 400 }, (_, i) => node(`${i}.png`));
  imageLibrarySession.directories.set("root:", {
    open: true,
    page: { nodes, next: 400 },
  });
  vi.mocked(imageDirectoryService.list).mockImplementation(
    async (_root, _path, offset) => ({
      nodes: nodes.slice(offset, offset + 200),
      next: offset === 0 ? 200 : 400,
    }),
  );
  const update = vi.fn();
  const unsubscribe = imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: update,
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.list).toHaveBeenLastCalledWith(
    "root",
    "",
    200,
    false,
  );
  expect(imageResourceCache.invalidate).not.toHaveBeenCalled();
  unsubscribe();
});
it("deleted selected files remain selected, and reappearance clears the missing state", async () => {
  selectImage(image("b.png"));
  vi.mocked(imageDirectoryService.list).mockResolvedValue({
    nodes: [node("a.png")],
    next: null,
  });
  const unsubscribe = imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: vi.fn(),
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(imageFileChange(image("b.png"))).toEqual({
    revision: 0,
    missing: true,
  });
  vi.mocked(imageDirectoryService.list).mockResolvedValue({
    nodes: [node("a.png"), node("b.png", 2)],
    next: null,
  });
  changed();
  await vi.advanceTimersByTimeAsync(250);
  expect(imageFileChange(image("b.png"))).toEqual({
    revision: 1,
    missing: false,
  });
  unsubscribe();
});
it("discarded monitors do not publish late requests after shutdown", async () => {
  let finish!: (page: { nodes: ImageNode[]; next: null }) => void;
  vi.mocked(imageDirectoryService.list).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const update = vi.fn();
  imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: update,
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  imageDirectoryMonitor.reset();
  finish({ nodes: [node("a.png", 3)], next: null });
  await Promise.resolve();
  await Promise.resolve();
  expect(update).not.toHaveBeenCalled();
  expect(imageFileChange(image("a.png")).revision).toBe(0);
});
it("does not mark an existing image deleted when new names shift it beyond the loaded page", async () => {
  const nodes = Array.from({ length: 200 }, (_, i) => node(`${i}.png`));
  imageLibrarySession.directories.set("root:", {
    open: true,
    page: { nodes, next: 200 },
  });
  vi.mocked(imageDirectoryService.list).mockResolvedValue({
    nodes: [node("added.png"), ...nodes.slice(0, -1)],
    next: 200,
  });
  vi.mocked(imageDirectoryService.stat).mockResolvedValue({
    size: 10,
    modified: 1,
  });
  selectImage(image("199.png"));
  const unsubscribe = imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: vi.fn(),
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(imageFileChange(image("199.png"))).toEqual({
    revision: 0,
    missing: false,
  });
  expect(imageResourceCache.invalidate).not.toHaveBeenCalled();
  unsubscribe();
});
it("collapsed/inactive browser directories do not keep polling", async () => {
  vi.mocked(imageDirectoryService.watch).mockResolvedValue(null);
  const unsubscribe = imageDirectoryMonitor.subscribe("root", "", {
    active: false,
    changed: vi.fn(),
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(30250);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.list).not.toHaveBeenCalled();
  unsubscribe();
});
it("releases watchers on unload while keeping them for a cached page transition", async () => {
  imageDirectoryMonitor.subscribe("root", "", {
    active: true,
    changed: vi.fn(),
    error: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(250);
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: true }),
  );
  expect(stop).not.toHaveBeenCalled();
  window.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: false }),
  );
  expect(stop).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(250);
  expect(imageDirectoryService.list).toHaveBeenCalledTimes(1);
});
