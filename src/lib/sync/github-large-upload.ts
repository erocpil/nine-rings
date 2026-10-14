/** Preserve the existing snapshot format while avoiding Contents' Base64 upload. */
export const GITHUB_LARGE_SNAPSHOT_BYTES = 8 * 1024 * 1024;

type RequestJson = (
  route: string,
  method?: "GET" | "POST" | "PATCH",
  body?: unknown,
) => Promise<unknown>;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub Git 数据接口返回无效对象");
  return value as Record<string, unknown>;
}
function sha(value: unknown): string {
  const result = record(value).sha;
  if (typeof result !== "string" || !/^[a-f0-9]{40}$/.test(result))
    throw new Error("GitHub Git 数据接口返回无效 SHA");
  return result;
}

async function contentSha(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("大备份完整性校验需要安全环境，请使用 HTTPS 或本机桌面版");
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", object)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadLargeGitSnapshot(
  request: RequestJson,
  path: string,
  content: string,
  message: string,
  initializeEmpty: () => Promise<void>,
): Promise<void> {
  const expectedBlob = await contentSha(content);
  let initialized = false;
  const repo = record(await request(""));
  const branch = repo.default_branch;
  if (typeof branch !== "string" || !branch.trim())
    throw new Error("GitHub 未返回有效的默认分支");
  // Git database endpoints cannot operate on a repository with no commits.
  // Bootstrap only this unpublished version's path; never write latest here.
  if (repo.size === 0) {
    try {
      await request(
        `/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        (error.status !== 404 && error.status !== 409)
      )
        throw error;
      await initializeEmpty();
      initialized = true;
    }
  }
  const branchPath = branch.split("/").map(encodeURIComponent).join("/");
  const ref = record(await request(`/git/ref/heads/${branchPath}`));
  const head = sha(ref.object);
  const commit = record(await request(`/git/commits/${head}`));
  const baseTree = sha(commit.tree);
  // UTF-8 avoids the 4/3 Base64 expansion, and the remote file is still JSON.
  if (!initialized) {
    try {
      await request(
        `/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      );
      throw new Error("备份版本路径已存在，已停止上传以免覆盖历史快照");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        error.status !== 404
      )
        throw error;
    }
  }
  const blob = sha(
    await request("/git/blobs", "POST", { content, encoding: "utf-8" }),
  );
  if (blob !== expectedBlob)
    throw new Error("GitHub Blob SHA 与本机快照不一致，停止发布备份");
  const tree = sha(
    await request("/git/trees", "POST", {
      base_tree: baseTree,
      tree: [{ path, mode: "100644", type: "blob", sha: blob }],
    }),
  );
  const next = sha(
    await request("/git/commits", "POST", { message, tree, parents: [head] }),
  );
  // A concurrent branch advance must reject this update. Never force or rebase
  // automatically: that could discard the other device's files or latest.
  const updated = record(
    await request(`/git/refs/heads/${branchPath}`, "PATCH", {
      sha: next,
      force: false,
    }),
  );
  if (sha(updated.object) !== next)
    throw new Error("GitHub 未确认备份提交的分支更新");
}
