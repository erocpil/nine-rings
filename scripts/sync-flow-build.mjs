import { build } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "node:http";

export async function syncFlowServer() {
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const result = await build({
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: {
        "decode-named-character-reference": fileURLToPath(
          new URL(
            "../node_modules/decode-named-character-reference/index.js",
            import.meta.url,
          ),
        ),
      },
    },
    worker: { format: "es" },
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(new URL("./sync-flow-probe.js", import.meta.url)),
        formats: ["iife"],
        name: "SyncFlow",
      },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  const script = output.find((item) => item.type === "chunk");
  if (!script || output.filter((item) => item.type === "chunk").length !== 1)
    throw Error("Unexpected flow bundle");
  const files = new Map(
    output
      .filter((item) => item.type === "asset")
      .map((item) => ["/" + item.fileName, item.source]),
  );
  files.set("/flow.js", script.code);
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><meta charset="utf-8"><script src="/flow.js"></script>',
      );
    } else if (files.has(request.url)) {
      response.setHeader(
        "Content-Type",
        request.url.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream",
      );
      response.end(files.get(request.url));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    candidateProfile: false,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
    fixture: JSON.parse(
      await readFile(
        new URL(
          "../schema/sync/fixtures/candidate-entities-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  };
}
