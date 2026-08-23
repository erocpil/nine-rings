const MAX_MARKDOWN_BYTES = 3 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type ExternalMarkdownProvider = "github" | "generic";

export interface NormalizedMarkdownUrl {
  originalUrl: string;
  requestUrl: string;
  provider: ExternalMarkdownProvider;
  fileName: string;
}

export interface ExternalMarkdownDownload extends NormalizedMarkdownUrl {
  resolvedUrl: string;
  source: string;
  bytes: number;
  contentHash: string;
  etag?: string;
  lastModified?: string;
}

interface DownloadOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

function markdownFileName(url: URL): string {
  const pathParts = url.pathname.split("/").filter(Boolean);
  const encoded = pathParts[pathParts.length - 1] ?? "document.md";
  try {
    return decodeURIComponent(encoded) || "document.md";
  } catch {
    return encoded || "document.md";
  }
}

function assertMarkdownPath(url: URL) {
  if (!/\.(?:md|markdown)$/i.test(url.pathname)) {
    throw new Error("第一版仅支持以 .md 或 .markdown 结尾的文档 URL");
  }
}

/** 将 GitHub 文件页面转换为公开 raw URL；其他 URL保持原样。 */
export function normalizeExternalMarkdownUrl(value: string): NormalizedMarkdownUrl {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("请输入 Markdown URL");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("URL 格式无效");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("仅支持 http:// 或 https:// URL");
  }
  if (url.username || url.password) throw new Error("URL 中不能包含用户名或密码");
  url.hash = "";

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "github.com" && segments.length >= 5 && (segments[2] === "blob" || segments[2] === "raw")) {
    const [owner, repo, , ref, ...path] = segments;
    const raw = new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.join("/")}`);
    assertMarkdownPath(raw);
    return {
      originalUrl: url.href,
      requestUrl: raw.href,
      provider: "github",
      fileName: markdownFileName(raw),
    };
  }

  assertMarkdownPath(url);
  return {
    originalUrl: url.href,
    requestUrl: url.href,
    provider: host === "raw.githubusercontent.com" ? "github" : "generic",
    fileName: markdownFileName(url),
  };
}

/** 快速、稳定的内容指纹，仅用于变更检测，不用于安全校验。 */
export function markdownContentFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function isRelativeMarkdownDestination(destination: string): boolean {
  const value = destination.trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return false;
  return !/^[a-z][a-z\d+.-]*:/i.test(value);
}

/** 将非代码围栏中的相对链接/图片地址转换为绝对 URL。 */
export function resolveMarkdownResourceUrls(source: string, sourceUrl: string): string {
  let fenced = false;
  return source.replace(/.*(?:\n|$)/g, (line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    return line.replace(
      /(!?\[[^\]\n]*\]\(\s*)(<?)([^\s)>]+)(>?)/g,
      (match, prefix: string, opening: string, destination: string, closing: string) => {
        if (!isRelativeMarkdownDestination(destination)) return match;
        try {
          const resolved = new URL(destination, sourceUrl).href;
          return `${prefix}${opening}${resolved}${closing}`;
        } catch {
          return match;
        }
      },
    );
  });
}

function validateResponseType(response: Response, resolvedUrl: URL) {
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") {
    throw new Error("URL 返回的是网页 HTML，不是 Markdown 原文；GitHub 请使用具体文件地址");
  }
  if (type && ![
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/markdown",
    "application/octet-stream",
  ].includes(type) && !/\.(?:md|markdown)$/i.test(resolvedUrl.pathname)) {
    throw new Error(`不支持的响应类型：${type}`);
  }
}

export async function downloadExternalMarkdown(
  value: string,
  options: DownloadOptions = {},
): Promise<ExternalMarkdownDownload> {
  const normalized = normalizeExternalMarkdownUrl(value);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await (options.fetchImpl ?? fetch)(normalized.requestUrl, {
      method: "GET",
      headers: { Accept: "text/markdown, text/plain;q=0.9, application/octet-stream;q=0.7" },
      cache: "no-cache",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const resolvedUrl = new URL(response.url || normalized.requestUrl);
    if (resolvedUrl.protocol !== "https:" && resolvedUrl.protocol !== "http:") {
      throw new Error("下载被重定向到不支持的协议");
    }
    validateResponseType(response, resolvedUrl);

    const maxBytes = options.maxBytes ?? MAX_MARKDOWN_BYTES;
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(`文档超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`文档超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限`);
    }
    const source = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
    return {
      ...normalized,
      resolvedUrl: resolvedUrl.href,
      source,
      bytes: buffer.byteLength,
      contentHash: markdownContentFingerprint(source),
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      if (options.signal?.aborted) throw new Error("已取消获取远端文档");
      throw new Error(`下载超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    }
    if (error instanceof TypeError) {
      throw new Error("无法下载该 URL；目标站点可能未允许浏览器跨域读取（CORS）");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
