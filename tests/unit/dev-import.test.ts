import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import importPlugin from "../../plugins/vite-import-plugin";
import {
  resolveConfig,
  isFileServingAllowed,
  type Connect,
  type ViteDevServer,
} from "vite";

const roots: string[] = [];
const token = "temporary-test-token-0123456789abcdef";
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function server(enabled = true) {
  vi.stubEnv("NR_DEV_IMPORT_TOKEN", enabled ? token : "");
  const root = mkdtempSync(join(tmpdir(), "nr-import-test-"));
  roots.push(root);
  let middleware: Connect.NextHandleFunction = () => {
    throw new Error("Middleware was not registered");
  };
  const configure = importPlugin().configureServer;
  if (typeof configure !== "function")
    throw new Error("Missing configureServer hook");
  configure({
    config: { root },
    middlewares: {
      use(_path: string, callback: Connect.NextHandleFunction) {
        middleware = callback;
      },
    },
  } as unknown as ViteDevServer);
  return (method: string, body?: unknown, auth = "Bearer " + token) => {
    const request = Object.assign(new EventEmitter(), {
      method,
      headers: { authorization: auth },
    });
    let result:
      | {
          status: number;
          body: { files: { title: string; _importId: string }[] };
        }
      | undefined;
    const response = {
      statusCode: 200,
      setHeader() {},
      end(value: string) {
        result = { status: response.statusCode, body: JSON.parse(value) };
      },
    };
    middleware(
      request as IncomingMessage,
      response as unknown as ServerResponse,
      () => {},
    );
    if (body !== undefined) {
      const bytes = Buffer.from(
        typeof body === "string" ? body : JSON.stringify(body),
      );
      // Exercise Unicode split across transport chunks, not just JSON boundaries.
      for (let offset = 0; offset < bytes.length; offset += 17)
        request.emit("data", bytes.subarray(offset, offset + 17));
      request.emit("end");
    }
    return result!;
  };
}
it("is opt-in and rejects unauthenticated writes/reads", () => {
  expect(server(false)("GET").status).toBe(404);
  const request = server();
  expect(request("GET", undefined, "").status).toBe(401);
  expect(request("POST", { files: [] }, "wrong").status).toBe(401);
  expect(request("DELETE").status).toBe(405);
});
it("denies static file access to the private queue without removing existing restrictions", async () => {
  const root = mkdtempSync(join(tmpdir(), "nr-import-test-"));
  roots.push(root);
  const config = await resolveConfig(
    {
      configFile: false,
      root,
      plugins: [importPlugin()],
      server: { fs: { deny: ["custom-secret"] } },
    },
    "serve",
  );
  for (const file of [
    ".nine-rings-import-queue.json",
    ".nine-rings-import-queue.json.partial.tmp",
    ".env",
    ".env.local",
    "custom-secret",
    ".git/config",
  ]) {
    expect(isFileServingAllowed(config, join(root, file))).toBe(false);
    expect(isFileServingAllowed(config, "/@fs/" + join(root, file))).toBe(
      false,
    );
  }
});
it("does not consume tasks until successful imports are acknowledged", () => {
  const request = server();
  const file = {
    title: "中文测试",
    content: { ops: [{ insert: "中文\n" }] },
    tags: [],
  };
  expect(request("POST", { files: [file, file] }).status).toBe(200);
  const first = request("GET").body.files;
  expect(first[0].title).toBe("中文测试");
  expect(request("GET").body.files).toEqual(first);
  expect(request("POST", { ack: [first[0]._importId] }).status).toBe(200);
  expect(request("GET").body.files).toEqual([first[1]]);
  expect(request("POST", { files: [{ title: "invalid" }] }).status).toBe(400);
  expect(request("GET").body.files).toEqual([first[1]]);
  expect(request("POST", "x".repeat(2 * 1024 * 1024 + 1)).status).toBe(413);
  expect(request("GET").body.files).toEqual([first[1]]);
});
