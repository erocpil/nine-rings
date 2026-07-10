#!/usr/bin/env python3
"""
serve.py — Nine Rings 静态服务 + 后台导入端点

用法:
  python3 serve.py                    # 默认 0.0.0.0:1420, 服务 dist/
  python3 serve.py --port 8080        # 自定义端口
  python3 serve.py --dir build        # 自定义静态目录

然后在另一终端:
  python3 scripts/md-to-nine-rings.py --serve *.md
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

QUEUE_FILE = os.path.join(tempfile.gettempdir(), "nine-rings-import-queue.json")


def read_queue():
    try:
        with open(QUEUE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def write_queue(items):
    with open(QUEUE_FILE, "w") as f:
        json.dump(items, f)


def clear_queue():
    try:
        os.unlink(QUEUE_FILE)
    except FileNotFoundError:
        pass


class NineRingsHandler(SimpleHTTPRequestHandler):
    """带 /__import 端点的静态文件服务"""

    def do_POST(self):
        if self.path == "/__import":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            try:
                data = json.loads(body)
                files = data.get("files", [])
                # ── dump: 打印每篇笔记的 content 结构摘要 ──
                for i, f in enumerate(files):
                    content = f.get("content", {})
                    ops = content.get("ops", [])
                    attr_types = set()
                    for op in ops:
                        attrs = op.get("attributes", {})
                        attr_types.update(attrs.keys())
                    print(f"  [dump] file[{i}] title={f.get('title','?')!r} "
                          f"ops={len(ops)} attrs={sorted(attr_types)} "
                          f"first_op={repr(ops[0]['insert'][:60] if ops else '—')}")
                # ── /dump ──
                queue = read_queue()
                queue.extend(files)
                write_queue(queue)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "count": len(files)}).encode())
                print(
                    f"[serve.py] 收到 {len(files)} 篇待导入笔记（队列: {len(queue)}）"
                )
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/__import":
            items = read_queue()
            clear_queue()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"files": items}).encode())
            if items:
                print(
                    f"[serve.py] 浏览器拉取 {len(items)} 篇笔记，队列已清空"
                )
        else:
            super().do_GET()

    def do_OPTIONS(self):
        """CORS preflight"""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    parser = argparse.ArgumentParser(description="Nine Rings 静态服务")
    parser.add_argument("--port", type=int, default=1420, help="监听端口（默认 1420）")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument(
        "--dir",
        default=None,
        help="静态文件目录（默认自动检测 dist/ 或当前目录）",
    )

    args = parser.parse_args()

    # 自动检测静态文件目录
    if args.dir:
        serve_dir = args.dir
    elif os.path.isdir("dist"):
        serve_dir = "dist"
    else:
        serve_dir = os.getcwd()

    os.chdir(serve_dir)
    print(f"📂 静态目录: {os.path.abspath(serve_dir)}")
    print(f"🌐 服务地址: http://{args.host}:{args.port}/")
    print(f"📥 导入端点: http://{args.host}:{args.port}/__import")
    print(f"   日记导入: python3 scripts/md-to-nine-rings.py --serve *.md")
    print(f"   文档导入: python3 scripts/md-to-nine-rings.py --serve --path projects/xxx ./docs/")
    print()

    server = HTTPServer((args.host, args.port), NineRingsHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 服务已停止")
        server.server_close()


if __name__ == "__main__":
    main()
