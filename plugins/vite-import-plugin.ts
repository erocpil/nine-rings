import type { Plugin } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { validateBackup } from "../src/lib/backup-validation";

const MAX_BYTES = 2 * 1024 * 1024;
interface ImportFile {
  _importId: string;
  title: string;
  content: unknown;
  tags?: string[];
  [key: string]: unknown;
}
export default function importPlugin(): Plugin {
  return {
    name: "nine-rings-import",
    config(config) {
      // The authenticated queue must not be downloadable via Vite's static
      // file or /@fs/ handlers. Preserve Vite 6's defaults and custom denies.
      return {
        server: {
          fs: {
            deny: [
              ".env",
              ".env.*",
              "*.{crt,pem}",
              "**/.git/**",
              ...(config.server?.fs?.deny ?? []),
              "**/.nine-rings-import-queue.json*",
            ],
          },
        },
      };
    },
    configureServer(server) {
      // Never embed this secret in client bundles. The developer supplies it to
      // the CLI and the consuming browser's sessionStorage explicitly.
      const token = process.env.NR_DEV_IMPORT_TOKEN ?? "";
      const queueFile = path.join(
        server.config.root,
        ".nine-rings-import-queue.json",
      );
      function read(): ImportFile[] {
        try {
          return JSON.parse(fs.readFileSync(queueFile, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      }
      function write(items: ImportFile[]) {
        const json = JSON.stringify(items);
        if (Buffer.byteLength(json) > MAX_BYTES * 8)
          throw new Error("导入队列已满");
        const temporary = queueFile + "." + randomUUID() + ".tmp";
        try {
          fs.writeFileSync(temporary, json, { mode: 0o600, flag: "wx" });
          fs.renameSync(temporary, queueFile);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      server.middlewares.use("/__import", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.end(JSON.stringify(body));
        };
        if (token.length < 32) {
          reply(404, { error: "开发导入未启用" });
          return;
        }
        const provided = Buffer.from(String(req.headers.authorization ?? ""));
        const expected = Buffer.from("Bearer " + token);
        if (
          provided.length !== expected.length ||
          !timingSafeEqual(provided, expected)
        ) {
          reply(401, { error: "需要开发导入令牌" });
          return;
        }
        if (req.method === "GET") {
          try {
            reply(200, { files: read() });
          } catch {
            reply(500, { error: "读取导入队列失败" });
          }
          return;
        }
        if (req.method !== "POST") {
          reply(405, { error: "不支持的方法" });
          return;
        }
        let chunks: Buffer[] = [];
        let bytes = 0;
        let oversized = false;
        req.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            if (!oversized) reply(413, { error: "导入数据过大" });
            oversized = true;
            chunks = [];
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (oversized) return;
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (
              Array.isArray(data.ack) &&
              data.ack.every((id: unknown) => typeof id === "string")
            ) {
              const ids = new Set(data.ack);
              write(read().filter((item) => !ids.has(item._importId)));
              reply(200, { ok: true });
              return;
            }
            if (
              !Array.isArray(data.files) ||
              !data.files.length ||
              data.files.length > 500
            )
              throw new Error("导入文件数组无效");
            const files: ImportFile[] = data.files.map((file: ImportFile) => ({
              ...file,
              _importId: randomUUID(),
            }));
            validateBackup({
              notes: files.map((file) => ({ ...file, id: file._importId })),
            });
            if (files.some((file) => typeof file.title !== "string"))
              throw new Error("标题无效");
            write([...read(), ...files]);
            reply(200, { ok: true, count: files.length });
          } catch {
            reply(400, { error: "导入数据无效或队列写入失败；原队列保持不变" });
          }
        });
      });
    },
  };
}
