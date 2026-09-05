#!/usr/bin/env python3
"""Static preview server. Authenticated development imports belong to Vite only."""
import argparse
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NineRingsHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/__import":
            self.send_error(410, "Use the authenticated Vite development import endpoint")
            return
        super().do_GET()

    def do_POST(self):
        self.send_error(405, "Static preview is read-only")

def main():
    parser = argparse.ArgumentParser(description="Nine Rings 静态预览（不提供写入接口）")
    parser.add_argument("--port", type=int, default=1420)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--dir", default=None)
    args = parser.parse_args()
    os.chdir(args.dir or ("dist" if os.path.isdir("dist") else os.getcwd()))
    print(f"静态预览：http://{args.host}:{args.port}/；开发导入请使用 Vite。")
    server = ThreadingHTTPServer((args.host, args.port), NineRingsHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
