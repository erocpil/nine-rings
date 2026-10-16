/** Create immutable Git objects for a durable frozen attempt; never update a ref. */
import {
  readValidatedPublication,
  recordPublicationObjects,
} from "./publication-recovery";
import { readPublicationSummary } from "./publication-store";
import { assertDocumentStorageGeneration } from "../document-storage-generation";
import {
  backupPaths,
  createPinnedReader,
  gitBlobSha,
  gitSha,
  record,
  type GitRead,
} from "./remote-protocol";

export type GitObjectPost = (
  route: "/git/blobs" | "/git/trees" | "/git/commits",
  body: Record<string, unknown>,
) => Promise<unknown>;

/** A failed creation can leave unreachable objects, but never a published snapshot.
 * The durable phase remains PREPARED until read-back verifies the whole commit. */
export async function preparePublicationObjects(input: {
  spaceId: string;
  request: GitRead;
  post: GitObjectPost;
  assertActive?: () => void;
}): Promise<string> {
  const { spaceId, request, post, assertActive = () => {} } = input;
  if (!globalThis.navigator?.locks) throw Error("当前环境不支持对象准备锁");
  return navigator.locks.request(
    `nr:sync-object-preparation:${spaceId}`,
    { mode: "exclusive" },
    async () => {
      // Re-run capability and content certification after restart, before any POST.
      const attempt = await readValidatedPublication(spaceId);
      if (attempt.phase !== "PREPARED")
        throw Error("当前发布阶段不允许准备对象");
      const guard = async () => {
        assertActive();
        assertDocumentStorageGeneration(attempt.storageGeneration);
        const current = await readPublicationSummary(spaceId);
        if (
          !current ||
          current.id !== attempt.id ||
          current.phase !== "PREPARED" ||
          current.commitSha !== null
        )
          throw Error("对象准备计划已变化");
        assertActive();
        assertDocumentStorageGeneration(attempt.storageGeneration);
      };
      const assertHead = async () => {
        await guard();
        const ref = await request(
          `/git/ref/heads/${attempt.space.branch.split("/").map(encodeURIComponent).join("/")}`,
        );
        if (
          !record(ref) ||
          !record(ref.object) ||
          ref.object.type !== "commit" ||
          ref.object.sha !== attempt.expectedParent
        )
          throw Error("远端已变化，需要重新预检，未发布对象");
        await guard();
      };
      await assertHead();
      const reader = createPinnedReader(request);
      const parent = await reader.commit(attempt.expectedParent);
      const paths = backupPaths(attempt.space.path);
      const files: [string, string][] = [
        [paths.snapshot(attempt.snapshotId), attempt.source],
        [paths.latest, attempt.snapshotId],
        ...(attempt.reviewed?.mode === "append"
          ? []
          : [[paths.control, attempt.control] as [string, string]]),
      ];
      if (
        await reader.file(
          attempt.expectedParent,
          paths.snapshot(attempt.snapshotId),
        )
      )
        throw Error("目标发布文件已存在，不能覆盖");
      if (
        !attempt.reviewed &&
        (await reader.file(attempt.expectedParent, paths.latest))
      )
        throw Error("目标发布文件已存在，不能覆盖");
      const oldControl = await reader.file(
        attempt.expectedParent,
        paths.control,
      );
      if (
        attempt.reviewed?.mode === "append"
          ? oldControl?.content !== attempt.control
          : !!oldControl
      )
        throw Error("控制文件证据不匹配，不能覆盖");
      const entries: {
        path: string;
        mode: "100644";
        type: "blob";
        sha: string;
      }[] = [];
      for (const [path, content] of files) {
        const expected = await gitBlobSha(content);
        await guard();
        const result = await post("/git/blobs", { content, encoding: "utf-8" });
        if (!record(result) || result.sha !== expected)
          throw Error("创建的 Blob 摘要不匹配");
        await guard();
        entries.push({ path, mode: "100644", type: "blob", sha: expected });
      }
      await guard();
      const tree = await post("/git/trees", {
        base_tree: (parent.tree as { sha: string }).sha,
        tree: entries,
      });
      if (!record(tree) || !gitSha(tree.sha))
        throw Error("创建的 Tree 身份无效");
      await guard();
      const commit = await post("/git/commits", {
        message: `Nine Rings backup ${attempt.snapshotId}`,
        tree: tree.sha,
        parents: [attempt.expectedParent],
      });
      if (!record(commit) || !gitSha(commit.sha))
        throw Error("创建的 Commit 身份无效");
      await assertHead();
      // Do not trust POST response fields as proof: GET the immutable commit/tree/blobs.
      await recordPublicationObjects(
        spaceId,
        commit.sha,
        request,
        assertActive,
      );
      return commit.sha;
    },
  );
}
