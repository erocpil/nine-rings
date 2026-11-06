import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const CMAP_DIRECTORY = join(process.cwd(), "node_modules/pdfjs-dist/cmaps");
const CMAP_ROUTE = "/pdfjs-cmaps/";

function cmapFiles(): string[] {
  return readdirSync(CMAP_DIRECTORY)
    .filter((name) => name.endsWith(".bcmap") && statSync(join(CMAP_DIRECTORY, name)).isFile());
}

/** Publish PDF.js CMaps as lazy static assets instead of adding them to JS. */
export default function pdfjsCMapAssets(): Plugin {
  return {
    name: "nine-rings-pdfjs-cmaps",
    configureServer(server) {
      const files = new Set(cmapFiles());
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "";
        if (!pathname.startsWith(CMAP_ROUTE)) return next();
        const name = pathname.slice(CMAP_ROUTE.length);
        if (!name.endsWith(".bcmap") || name.includes("/") || !files.has(name)) {
          response.statusCode = 404;
          response.end("Not Found");
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(readFileSync(join(CMAP_DIRECTORY, name)));
      });
    },
    generateBundle() {
      for (const name of cmapFiles()) {
        this.emitFile({
          type: "asset",
          fileName: `pdfjs-cmaps/${name}`,
          source: readFileSync(join(CMAP_DIRECTORY, name)),
        });
      }
    },
  };
}
