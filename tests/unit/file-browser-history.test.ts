import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BrowserQueueHistory,
  BROWSER_HISTORY_PREFIX,
  browserHistoryReport,
  clearBrowserQueueHistory,
  readBrowserQueueHistory,
} from "../../src/lib/local-files/browser-queue-history";
import type { BrowserJob } from "../../src/lib/local-files/browser-operation-queue";
const job = (status: BrowserJob["status"] = "running"): BrowserJob => ({
  id: 1,
  name: "",
  operation: {
    kind: "copy",
    rootId: "r",
    rootName: "Root",
    parent: "",
    targetRootId: "s",
    targetRootName: "Other",
    targetParent: "",
    nodes: ["a"],
  },
  status,
  progress: { completed: 0, skipped: 0, total: 1, current: "a" },
  items: [{ node: "a", targetName: "a", status: "running" }],
  queuedAt: 10,
});
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("keeps only bounded inert reports across sessions, never executable queue inputs", () => {
  for (let index = 0; index < 8; index++) {
    const history = new BrowserQueueHistory();
    history.capture([job("completed")]);
    history.dispose();
  }
  expect(values.size).toBe(5);
  const records = readBrowserQueueHistory();
  expect(records).toHaveLength(5);
  expect(records[0].report).toContain("Root");
  expect(JSON.parse([...values.values()][0])).not.toHaveProperty("operation");
  clearBrowserQueueHistory(records[0].session);
  expect(values.size).toBe(1);
  expect(readBrowserQueueHistory(records[0].session)).toEqual([]);
});
it("records a pre-write state and coalesces item progress, flushes terminal results and handles storage failure", () => {
  vi.useFakeTimers();
  const history = new BrowserQueueHistory();
  history.capture([job()]);
  expect(readBrowserQueueHistory()[0].report).toContain("running");
  const set = vi.spyOn(localStorage, "setItem");
  history.capture([
    { ...job(), progress: { ...job().progress, current: "checking" } },
  ]);
  history.capture([
    { ...job(), progress: { ...job().progress, current: "next" } },
  ]);
  expect(set).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  expect(set).toHaveBeenCalledTimes(1);
  history.capture([
    {
      ...job("completed"),
      items: [{ node: "a", targetName: "a", status: "completed" }],
    },
  ]);
  expect(readBrowserQueueHistory()[0].report).toContain("成功 1");
  set.mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => history.capture([job("failed")])).not.toThrow();
  expect(history.issue).toContain("无法保存");
  history.dispose();
});
it("ignores corrupt and oversized records, truncates large reports and removes empty live records", () => {
  values.set(BROWSER_HISTORY_PREFIX + "bad", "{");
  values.set(BROWSER_HISTORY_PREFIX + "large", "x".repeat(300000));
  values.set(
    BROWSER_HISTORY_PREFIX + "wrong",
    JSON.stringify({ version: 2, report: "bad", updatedAt: 1 }),
  );
  values.set("other", "keep");
  expect(readBrowserQueueHistory()).toEqual([]);
  const report = browserHistoryReport([
    {
      ...job(),
      items: Array.from({ length: 2000 }, (_, index) => ({
        node: `${index}/` + "x".repeat(5000),
        targetName: "a",
        status: "uncertain",
      })),
    },
  ]);
  expect(report.length).toBeLessThan(11000);
  expect(report).toContain("需核对 2000");
  const history = new BrowserQueueHistory();
  history.capture([job()]);
  history.capture([]);
  history.dispose();
  expect(values.has(history.key)).toBe(false);
  clearBrowserQueueHistory();
  expect(values.get("other")).toBe("keep");
});
