import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  tree: vi.fn(),
  get: vi.fn(),
  paths: vi.fn(),
}));
vi.mock("../../src/lib/api", () => ({
  api: { docs: { summaries: mocks.tree }, notes: { get: mocks.get } },
}));
vi.mock("../../src/lib/storage/protection-state", () => ({
  listProtectedPaths: mocks.paths,
  withProtectionWrite: (task: () => Promise<unknown>) => task(),
}));
vi.mock("../../src/lib/markdown-serializer", () => ({
  noteToMarkdown: (title: string) => `# ${title}`,
}));
import {
  vocabularyDocuments,
  readVocabularyPreference,
  VOCABULARY_ID,
} from "../../src/lib/plugin-system/builtin-vocabulary";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { workspacePanels } from "../../src/lib/plugin-system/panel-registry";
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        enabled: true,
        path: "references/vocabulary",
        collapseExamples: true,
      }),
  });
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate(VOCABULARY_ID, [
    "panels.present",
    "documents.vocabulary.read",
  ]);
  workspacePanels.register(owner, {
    id: "vocabulary",
    label: "词汇",
    icon: "book",
    renderer: "vocabulary-library",
  });
  mocks.paths.mockResolvedValue([]);
  mocks.get.mockResolvedValue({
    id: "word",
    title: "sample",
    storagePath: "references/vocabulary",
    content: { ops: [] },
  });
});
afterEach(() => {
  pluginRuntime.deactivate(VOCABULARY_ID);
  pluginRuntime.setEnabled(false);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("lists only scoped unprotected summaries without loading bodies", async () => {
  mocks.paths.mockResolvedValue([{ path: "references/vocabulary/private" }]);
  mocks.tree.mockResolvedValue([
    {
      id: "word",
      title: "sample",
      storagePath: "references/vocabulary",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    },
    {
      id: "private",
      title: "hidden",
      storagePath: "references/vocabulary/private",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    },
    {
      id: "other",
      title: "other",
      storagePath: "ideas",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    },
  ]);
  expect((await vocabularyDocuments.list()).map((item) => item.id)).toEqual([
    "word",
  ]);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.tree).toHaveBeenCalledWith({
    storagePath: "references/vocabulary",
  });
});
it("denies out-of-scope, protected, missing and revoked reads", async () => {
  expect(await vocabularyDocuments.read("word")).toMatchObject({
    source: "# sample",
  });
  mocks.get.mockResolvedValueOnce({
    id: "other",
    storagePath: "ideas",
    content: { ops: [] },
  });
  await expect(vocabularyDocuments.read("other")).rejects.toThrow("路径之外");
  mocks.get.mockResolvedValueOnce({
    id: "encrypted",
    storagePath: "references/vocabulary",
    content: { encrypted: { version: 1 } },
  });
  await expect(vocabularyDocuments.read("encrypted")).rejects.toThrow("受保护");
  mocks.paths.mockResolvedValueOnce([{ path: "references" }]);
  await expect(vocabularyDocuments.read("word")).rejects.toThrow("受保护路径");
  mocks.get.mockResolvedValueOnce(null);
  await expect(vocabularyDocuments.read("gone")).rejects.toThrow("不存在");
  mocks.get.mockImplementationOnce(async () => {
    pluginRuntime.deactivate(VOCABULARY_ID);
    return { id: "word", content: { ops: [] } };
  });
  await expect(vocabularyDocuments.read("word")).rejects.toThrow();
});
it("corrupt empty paths never grant workspace-wide access", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => '{"enabled":true,"path":"","collapseExamples":true}',
  });
  expect(readVocabularyPreference().enabled).toBe(false);
});
