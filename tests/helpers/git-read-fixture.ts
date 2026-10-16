import { Buffer } from "node:buffer";
import { gitBlobSha } from "../../src/lib/sync/remote-protocol";
export async function gitReadFixture(
  files: Record<string, string>,
  parents: string[] = [],
) {
  const head = "a".repeat(40),
    tree = "b".repeat(40);
  const objects = new Map<string, unknown>();
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const sha = await gitBlobSha(content),
      bytes = new TextEncoder().encode(content);
    objects.set(`/git/blobs/${sha}`, {
      sha,
      size: bytes.length,
      encoding: "base64",
      content: Buffer.from(bytes).toString("base64"),
    });
    entries.push({
      path,
      sha,
      type: "blob",
      mode: "100644",
      size: bytes.length,
    });
  }
  objects.set("", { default_branch: "backup/main" });
  objects.set("/git/ref/heads/backup/main", {
    object: { type: "commit", sha: head },
  });
  objects.set(`/git/commits/${head}`, {
    sha: head,
    tree: { sha: tree },
    parents: parents.map((sha) => ({ sha })),
  });
  objects.set(`/git/trees/${tree}`, {
    sha: tree,
    truncated: false,
    tree: entries,
  });
  const calls: string[] = [];
  return {
    head,
    tree,
    objects,
    calls,
    request: async (route: string): Promise<unknown> => {
      calls.push(route);
      if (!objects.has(route)) throw Error("HTTP 404");
      return structuredClone(objects.get(route));
    },
  };
}
