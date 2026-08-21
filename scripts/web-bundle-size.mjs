import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const distDir = path.join(process.cwd(), "dist");
const assetsDir = path.join(distDir, "assets");

function asKb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

if (!fs.existsSync(distDir)) {
  console.error("[bundle-size] dist 目录不存在；请先运行 npm run build");
  process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
  console.error("[bundle-size] dist/assets 目录不存在");
  process.exit(1);
}

function getLimit(fileName, kind) {
  if (kind === "js") {
    if (/^index-/.test(fileName)) {
      return Number(process.env.WEB_BUNDLE_MAX_MAIN_GZIP_KB ?? 340);
    }
    return Number(process.env.WEB_BUNDLE_MAX_GZIP_KB ?? 240);
  }
  if (kind === "css") {
    return Number(process.env.WEB_BUNDLE_MAX_CSS_GZIP_KB ?? 80);
  }
  return Number(process.env.WEB_BUNDLE_MAX_ASSET_KB ?? 120);
}

const entries = fs.readdirSync(assetsDir)
  .map((name) => path.join(assetsDir, name))
  .filter((filePath) => {
    const name = path.basename(filePath);
    return fs.statSync(filePath).isFile() && /\.(js|css)$/i.test(name);
  })
  .map((filePath) => {
    const name = path.basename(filePath);
    const raw = fs.statSync(filePath).size;
    const gzip = gzipSync(fs.readFileSync(filePath)).length;
    const kind = name.endsWith(".css") ? "css" : "js";
    const limit = getLimit(name, kind);

    return {
      name,
      kind,
      raw_bytes: raw,
      raw_kb: asKb(raw),
      gzip_bytes: gzip,
      gzip_kb: asKb(gzip),
      limit_kb: limit,
      over_limit: asKb(gzip) > limit,
    };
  });

const sorted = entries.slice().sort((a, b) => b.gzip_bytes - a.gzip_bytes);

console.log("[bundle-size] 资源体积清单（gzip）");
for (const item of sorted) {
  const tag = item.over_limit ? "OVER" : "OK  ";
  const limit = item.limit_kb === Infinity ? "-" : `${item.limit_kb.toFixed(2)}KB`;
  console.log(
    `${tag} ${item.name.padEnd(40)} raw ${item.raw_kb.toFixed(2)}KB | gzip ${item.gzip_kb.toFixed(2)}KB | limit ${limit}`,
  );
}

const violations = sorted.filter((item) => item.over_limit);
const reportPath = path.join(distDir, ".bundle-size-report.json");
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      assets: sorted,
      violations,
    },
    null,
    2,
  ),
);

console.log(`\n[bundle-size] 已生成: ${path.relative(process.cwd(), reportPath)}`);

if (violations.length > 0) {
  console.error(`\n[bundle-size] 发现 ${violations.length} 个超预算资源：`);
  for (const item of violations) {
    console.error(`- ${item.name}: gzip=${item.gzip_kb}KB, limit=${item.limit_kb}KB`);
  }
  console.error("[bundle-size] 可通过 WEB_BUNDLE_MAX_MAIN_GZIP_KB / WEB_BUNDLE_MAX_GZIP_KB / WEB_BUNDLE_MAX_CSS_GZIP_KB 调整阈值");
  process.exit(1);
}

console.log("[bundle-size] 所有监控资源均满足预算");
