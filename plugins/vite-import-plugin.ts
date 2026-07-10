/**
 * vite-import-plugin.ts — 开发模式后台导入端点
 *
 * POST /__import  — 接收 CLI 脚本发来的待导入笔记数据
 * GET  /__import  — 浏览器轮询拉取待导入笔记（拉取后清空队列）
 *
 * 队列持久化到临时文件，避免 dev server 重启（如 vite.config.ts 变更）导致数据丢失。
 */

import type { Plugin } from "vite";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const QUEUE_FILE = path.join(os.tmpdir(), "nine-rings-import-queue.json");

interface ImportFile {
  title: string;
  content: any;
  tags?: string[];
}

function readQueue(): ImportFile[] {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeQueue(items: ImportFile[]) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(items), "utf-8");
}

function clearQueue() {
  try {
    fs.unlinkSync(QUEUE_FILE);
  } catch {
    // 文件不存在时忽略
  }
}

export default function importPlugin(): Plugin {
  return {
    name: "nine-rings-import",

    configureServer(server) {
      server.middlewares.use("/__import", (req, res) => {
        res.setHeader("Content-Type", "application/json");

        // ── POST: CLI 脚本发送导入数据 ──
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              const files: ImportFile[] = data.files || [];
              const queue = readQueue();
              queue.push(...files);
              writeQueue(queue);
              console.log(
                `[import-plugin] 收到 ${files.length} 篇待导入笔记（队列: ${queue.length}）`
              );
              res.end(JSON.stringify({ ok: true, count: files.length }));
            } catch (e: any) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }

        // ── GET: 浏览器轮询拉取 ──
        if (req.method === "GET") {
          const items = readQueue();
          clearQueue();
          res.end(JSON.stringify({ files: items }));
          if (items.length > 0) {
            console.log(
              `[import-plugin] 浏览器拉取 ${items.length} 篇笔记，队列已清空`
            );
          }
          return;
        }

        // 其他方法
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
      });
    },
  };
}
