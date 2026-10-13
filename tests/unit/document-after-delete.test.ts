import { expect, it, vi } from "vitest";
import { documentAfterDelete } from "../../src/lib/document-after-delete";
import type { Note } from "../../src/types/models";
const note = (id: string) => ({ id }) as Note;
it("删除整批后按最近访问选仍存在的文档，跳过已删除历史", async () => {
  const get = vi.fn(async (id: string) => (id === "missing" ? null : note(id)));
  const summaries = vi.fn(async () => []);
  expect(
    (
      await documentAfterDelete(
        ["active", "batch"],
        ["active", "missing", "batch", "recent", "older"],
        get,
        summaries,
      )
    )?.id,
  ).toBe("recent");
  expect(get.mock.calls.map(([id]) => id)).toEqual(["missing", "recent"]);
  expect(summaries).not.toHaveBeenCalled();
});
it("没有可用访问历史时按更新时间回退，确实无文档才返回空", async () => {
  const summaries = async () => [
    { id: "old", updated_at: "2026-01-01" },
    { id: "new", updated_at: "2026-10-14" },
    { id: "deleted", updated_at: "2026-11-01" },
  ];
  expect(
    (
      await documentAfterDelete(
        ["deleted"],
        [],
        async (id) => note(id),
        summaries,
      )
    )?.id,
  ).toBe("new");
  expect(
    await documentAfterDelete(["deleted"], [], async () => null, summaries),
  ).toBeNull();
});
