import { inspectRemoteProtocol, type RemoteProtocolReport } from "./remote-protocol";
import { assertLegacyConnectionAllowed, observeRemoteProtocol, markProtocolInspectionRequired } from "./protocol-connection";
import { assertSyncCapabilities } from "./protocol-capabilities";
import { measureTransfer } from "./measurement-store";
/**
 * GitHub 同步服务 — 方案 A：全量 JSON 快照
 *
 * 数据流：
 *   Push: 本地数据库 → 序列化 JSON → GitHub 版本化全量快照
 *   Pull: GET → 按 UUID 与共同基线比较 → 安全合并（默认）或显式全量覆盖
 *
 * 认证：个人访问令牌（Personal Access Token），需 repo 权限。
 * 设置 → 填入 token + owner/repo → 测试连接 → 手动/定时同步。
 */

import { GITHUB_LARGE_SNAPSHOT_BYTES, uploadLargeGitSnapshot } from "./github-large-upload";
import { addLog } from "../debugLog";
import { backupDiagnosticSummary } from "./diagnostics";
import { GitHubWriteHttpError, syncErrorMessage } from "./errors";
import { isTauriRuntime } from "../runtime";
import { validateBackup } from "../backup-validation";
import { withBackupRestore, type RestoreContext } from "../backup-restore-coordination";
import {
  buildSafeMergedBackup,
  compareBackupSnapshots,
  extractRemoteDocumentPreviews,
  type BackupComparison,
  type SyncRemoteDocumentPreview,
  type SafeMergeOptions,
} from "./backup-merge";

// ── 类型 ──

export interface SyncConfig {
  /** GitHub Personal Access Token（classic 或 fine-grained，需 repo 权限） */
  token: string;
  /** 仓库所有者 */
  owner: string;
  /** 仓库名 */
  repo: string;
  /** 备份文件在仓库中的路径，默认 "nine-rings-backup.json" */
  path: string;
  /** 上次同步时间 */
  lastSyncAt: string | null;
  /** 远端文件 SHA（PUT 时需要，防止覆盖冲突） */
  remoteSha: string | null;
  /** 最近一次 Push 的数据版本（ISO 时间戳 "20260715T123000"） */
  lastPushVersion: string | null;
  /** 最近一次 Pull 的数据版本 */
  lastPullVersion: string | null;
  /** 是否持久保存 Token（false=会话级） */
  rememberToken: boolean;
}

export interface SyncStatus {
  ok: boolean;
  message: string;
  /** 远端最后修改时间 */
  remoteAt?: string;
  /** 本地最后同步时间 */
  localAt?: string | null;
}

// ── 配置持久化 ──

const STORAGE_KEY = "nr:github-sync";
const TOKEN_VALUE_KEY = "nr:github-sync-token";
const TOKEN_MODE_KEY = "nr:github-sync-token-mode";
const GITHUB_REQUEST_TIMEOUT_MS = 20_000;

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  token: "",
  owner: "",
  repo: "",
  path: "nine-rings-backup.json",
  lastSyncAt: null,
  remoteSha: null,
  lastPushVersion: null,
  lastPullVersion: null,
  rememberToken: false,
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getWebStorage(): { localStorage: StorageLike | undefined; sessionStorage: StorageLike | undefined } {
  if (!hasWebStorage()) return { localStorage: undefined, sessionStorage: undefined };
  try {
    return { localStorage: window.localStorage, sessionStorage: window.sessionStorage };
  } catch {
    return { localStorage: undefined, sessionStorage: undefined };
  }
}

function hasWebStorage(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.localStorage !== "undefined"
    && typeof window.sessionStorage !== "undefined"
  );
}

function safeGet(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(storage: StorageLike | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

function parseSyncConfig(raw: string | null): SyncConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    return {
      ...DEFAULT_SYNC_CONFIG,
      ...parsed,
      token: typeof parsed.token === "string" ? parsed.token : "",
      rememberToken: Boolean(parsed.rememberToken),
    };
  } catch {
    return null;
  }
}

function readBool(raw: string | null, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

function loadTokenFromStorage(config: SyncConfig): string {
  if (!hasWebStorage()) {
    return config.token ?? "";
  }
  const { localStorage, sessionStorage } = getWebStorage();
  const rememberToken = readBool(safeGet(localStorage, TOKEN_MODE_KEY), Boolean(config.rememberToken));
  if (rememberToken) {
    return safeGet(localStorage, TOKEN_VALUE_KEY) ?? config.token ?? "";
  }
  return safeGet(sessionStorage, TOKEN_VALUE_KEY) ?? config.token ?? "";
}

function saveTokenStorage(token: string, rememberToken: boolean): void {
  if (!hasWebStorage()) return;
  const { localStorage, sessionStorage } = getWebStorage();
  const trimmed = token.trim();
  safeSet(localStorage, TOKEN_MODE_KEY, rememberToken ? "1" : "0");
  if (trimmed) {
    if (rememberToken) {
      safeSet(localStorage, TOKEN_VALUE_KEY, trimmed);
      safeRemove(sessionStorage, TOKEN_VALUE_KEY);
    } else {
      safeSet(sessionStorage, TOKEN_VALUE_KEY, trimmed);
      safeRemove(localStorage, TOKEN_VALUE_KEY);
    }
  } else {
    safeRemove(localStorage, TOKEN_VALUE_KEY);
    safeRemove(sessionStorage, TOKEN_VALUE_KEY);
  }
}

export interface SyncSnapshotSummary {
  version: string | null;
  exportedAt: string | null;
  noteCount: number;
  size: number;
  backupDevice?: {
    id?: string;
    name?: string;
    runtime?: string;
    platform?: string;
  };
}

export interface PullPrecheck {
  local: SyncSnapshotSummary;
  remote: SyncSnapshotSummary & {
    version: string;
    path: string;
    ptrPath: string;
    sha: string | null;
  };
  comparison: BackupComparison;
  /** 用于三方比较的上次 Push/Pull 快照；null 表示只能保守识别冲突。 */
  baseVersion: string | null;
  remoteDocuments: SyncRemoteDocumentPreview[];
  localDocuments: SyncRemoteDocumentPreview[];
}

export function formatBackupDevice(device?: SyncSnapshotSummary["backupDevice"]): string {
  const name = device?.name?.trim()
    || [device?.runtime?.trim(), device?.platform?.trim()].filter(Boolean).join(" / ");
  const id = device?.id?.trim();
  return [name, id ? `设备ID ${id.slice(0, 8)}` : ""].filter(Boolean).join(" · ")
    || "未知设备（备份未记录设备信息）";
}

function backupError(reason: unknown, context: string): Error {
  return new Error(`${syncErrorMessage(reason)}\n${context}`);
}

function validateRemoteBackup(json: string, version: string): void {
  try {
    if (!json.trim()) throw new Error("远端备份文件为空，未修改本地数据");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("远端备份文件内容不是有效 JSON，未修改本地数据");
    }
    assertSyncCapabilities(parsed, { operation: "read", expectedId: version });
    validateBackup(parsed);
  } catch (reason) {
    throw backupError(reason, `远端版本：${version}\n远端备份来源：${formatBackupDevice(summarizeBackup(json).backupDevice)}`);
  }
}

export type PullMode = "safe-merge" | "replace";

export interface PullOptions extends SafeMergeOptions {
  mode?: PullMode;
  /** 防止预检之后 latest 指针已变化却仍按旧摘要执行。 */
  expectedVersion?: string;
  ignoreRemoteNoteIds?: readonly string[];
  ignoreRemotePaths?: readonly string[];
}

export function loadSyncConfig(): SyncConfig {
  try {
    const { localStorage } = getWebStorage();
    const parsed = parseSyncConfig(safeGet(localStorage, STORAGE_KEY));
    if (parsed) {
      const rememberToken = readBool(safeGet(localStorage, TOKEN_MODE_KEY), parsed.rememberToken);
      const token = loadTokenFromStorage(parsed);
      const loaded = { ...parsed, token, rememberToken };
      // 旧版本曾把 Token 直接写入配置 JSON。Web 首次读取时立即迁移到
      // sessionStorage（默认）或独立的持久键，并清除配置中的明文副本。
      if (parsed.token) saveSyncConfig(loaded);
      return loaded;
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SYNC_CONFIG };
}

export function saveSyncConfig(config: SyncConfig): void {
  const { localStorage } = getWebStorage();
  if (!localStorage || !hasWebStorage()) return;
  const trimmedToken = config.token.trim();
  const rememberToken = Boolean(config.rememberToken);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, token: "", rememberToken }));
  saveTokenStorage(trimmedToken, rememberToken);
}

function summarizeBackup(json: string): SyncSnapshotSummary {
  try {
    const data = JSON.parse(json) as {
      version?: string;
      exported_at?: string;
      notes?: unknown[];
      backup_metadata?: {
        device?: {
          id?: string;
          name?: string;
          runtime?: string;
          platform?: string;
        };
      };
    };
    const metadata = data.backup_metadata?.device;
    return {
      version: data.version ?? null,
      exportedAt: data.exported_at ?? null,
      noteCount: Array.isArray(data.notes) ? data.notes.length : 0,
      size: new TextEncoder().encode(json).length,
      backupDevice: metadata
        ? {
          id: typeof metadata.id === "string" ? metadata.id : undefined,
          name: typeof metadata.name === "string" ? metadata.name : undefined,
          runtime: typeof metadata.runtime === "string" ? metadata.runtime : undefined,
          platform: typeof metadata.platform === "string" ? metadata.platform : undefined,
        }
        : undefined,
    };
  } catch {
    return {
      version: null,
      exportedAt: null,
      noteCount: 0,
      size: new TextEncoder().encode(json).length,
      backupDevice: undefined,
    };
  }
}

// ── API 调用 ──

function authHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** 按实际传输字节预算：至少两分钟，以 64 KiB/s 留出余量，最多十分钟。 */
export function githubTransferTimeoutMs(bytes = 0): number {
  return Math.min(600_000, 120_000 + Math.ceil(Math.max(0, bytes) / 65_536) * 1000);
}

export interface PushProgress {
  phase: "checking" | "exporting" | "uploading" | "publishing";
  bytes?: number;
  timeoutMs?: number;
}

export interface PushOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PushProgress) => void;
}

function checkPushCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("GitHub 请求已取消");
}

/** Deadline includes the response body, even when a WebView ignores abort. */
export async function githubApiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (init.signal?.aborted) abortFromCaller();
  let rejectAbort: () => void = () => {};
  try {
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("Request aborted"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    return await Promise.race([aborted, (async () => {
      checkPushCancellation(controller.signal);
      const native = isTauriRuntime();
      const request = native
        ? (await import("@tauri-apps/plugin-http")).fetch
        : fetch;
      checkPushCancellation(controller.signal);
      const readResponse = async (response: Response): Promise<Response> => {
        let body: Blob | null = null;
        const reader = response.body?.getReader();
        if (reader) {
          const cancelBody = () => { void reader.cancel().catch(() => {}); };
          controller.signal.addEventListener("abort", cancelBody, { once: true });
          if (controller.signal.aborted) cancelBody();
          try {
            const chunks: BlobPart[] = [];
            while (true) {
              checkPushCancellation(controller.signal);
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value.slice());
            }
            checkPushCancellation(controller.signal);
            body = new Blob(chunks);
          } finally {
            controller.signal.removeEventListener("abort", cancelBody);
            reader.releaseLock();
          }
        }
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
      try {
        return await readResponse(await request(input, { ...init, signal: controller.signal }));
      } catch (nativeError) {
        // reqwest may reject while decoding a response stream. Retry only this
        // known native read failure via the independent WebView HTTP stack.
        // Never replay writes, relax TLS, or bypass a native scope denial.
        if (!native || controller.signal.aborted
          || !/^error decoding response body(?:$|:)/i.test(syncErrorMessage(nativeError))) {
          throw nativeError;
        }
        const original = input instanceof Request ? input : null;
        const method = (init.method ?? original?.method ?? "GET").toUpperCase();
        let url: URL;
        try { url = new URL(original?.url ?? String(input)); } catch { throw nativeError; }
        if (method !== "GET" || url.origin !== "https://api.github.com" || url.username || url.password) {
          throw nativeError;
        }
        addLog("[Sync] 原生响应体解码失败，使用 WebView 重试一次 GitHub GET（共用原超时预算）");
        try {
          checkPushCancellation(controller.signal);
          return await readResponse(await fetch(input, {
            ...init, signal: controller.signal, credentials: "omit", redirect: "error",
          }));
        } catch (fallbackError) {
          throw new Error(`原生下载：${syncErrorMessage(nativeError)}\nWebView 重试：${syncErrorMessage(fallbackError)}`);
        }
      }
    })()]);
  } catch (reason) {
    if (controller.signal.aborted) {
      if (init.signal?.aborted) throw new Error("GitHub 请求已取消");
      throw new Error(`GitHub 请求超时（${Math.ceil(timeoutMs / 1000)} 秒）。请检查网络、代理或防火墙是否允许访问 api.github.com；上传超时不代表远端一定未写入，请先检查远端状态`);
    }
    if (reason instanceof TypeError) {
      throw new Error(`无法连接 GitHub API。请检查本机网络、代理或防火墙是否允许访问 api.github.com。\n原始错误：${syncErrorMessage(reason)}`);
    }
    throw new Error(`GitHub 请求失败：${syncErrorMessage(reason)}`);
  } finally {
    globalThis.clearTimeout(timeout);
    controller.signal.removeEventListener("abort", rejectAbort);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * GitHub Contents API 将仓库内路径作为 URL path 的一部分。
 * 必须逐段编码：编码整个路径会把 `/` 变成 `%2F`，在部分 WebView/代理下
 * 会被当作单个文件名，导致配置了子目录的备份无法读写。
 */
export function githubContentsUrl(owner: string, repo: string, path: string): string {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}

/** 获取远端文件内容 + sha */
async function fetchRemote(token: string, owner: string, repo: string, path: string, signal?: AbortSignal): Promise<{ content: string; sha: string } | null> {
  const url = githubContentsUrl(owner, repo, path);
  const res = await githubApiFetch(url, { headers: authHeader(token), signal }, path.endsWith("-latest") ? GITHUB_REQUEST_TIMEOUT_MS : githubTransferTimeoutMs());
  if (res.status === 404) return null; // 文件不存在
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  // 防御：先读文本，再解析 JSON，避免空 body 导致 "Unexpected end of JSON input"
  const text = await res.text();
  if (!text) {
    throw new Error("GitHub API 返回空响应体（可能是代理截断或网络问题）");
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GitHub API 返回非 JSON 内容: ${text.slice(0, 200)}`);
  }

  if (!isRecord(data) || typeof data.sha !== "string" || !data.sha) {
    throw new Error("GitHub API 返回数据缺少有效 sha 字段");
  }

  // GitHub Contents API: 文件 >1MB 时不返回 base64 content
  const content = typeof data.content === "string" ? data.content : "";
  const hasContent = content.length > 0 && data.encoding === "base64";

  let decodedContent: string;

  if (hasContent) {
    // Push 侧用 btoa(unescape(encodeURIComponent(str))) 编码 UTF-8
    // Pull 侧必须对称解码: atob → escape → decodeURIComponent
    const binaryStr = atob(content);
    decodedContent = decodeURIComponent(escape(binaryStr));
  } else {
    // 大文件：用 Git Blobs API 拉取。
    console.log(`[fetchRemote] 文件 >1MB，用 Git Blobs API (sha=${data.sha.slice(0, 7)})`);
    const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${data.sha}`;
    const blobRes = await githubApiFetch(blobUrl, { headers: authHeader(token), signal },
      githubTransferTimeoutMs(typeof data.size === "number" ? Math.ceil(data.size * 4 / 3) : 0));
    if (!blobRes.ok) {
      throw new Error(`Git Blobs API ${blobRes.status}`);
    }
    const blobData: unknown = await blobRes.json();
    if (!isRecord(blobData) || typeof blobData.content !== "string" || !blobData.content || blobData.encoding !== "base64") {
      throw new Error("Git Blobs API 返回非 base64 内容");
    }
    const binaryStr = atob(blobData.content);
    decodedContent = decodeURIComponent(escape(binaryStr));
  }

  return { content: decodedContent, sha: data.sha };
}

/** 上传/更新远端文件 */
async function putRemote(token: string, owner: string, repo: string, path: string, content: string, sha: string | null, message: string, options: PushOptions = {}, phase: PushProgress["phase"] = "uploading"): Promise<string> {
  const url = githubContentsUrl(owner, repo, path);
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // 正确处理 UTF-8
  };
  if (sha) body.sha = sha;
  const payload = JSON.stringify(body);
  const bytes = new TextEncoder().encode(payload).byteLength;
  const timeoutMs = githubTransferTimeoutMs(bytes);
  const contentBytes = new TextEncoder().encode(content).byteLength;
  checkPushCancellation(options.signal);
  addLog(`[Sync] PUT ${phase === "publishing" ? "发布最新指针" : "上传数据文件"} | 路径: ${path} | 原文: ${contentBytes} bytes | 请求: ${bytes} bytes | 通道: ${isTauriRuntime() ? "Tauri 原生 HTTP" : "WebView / 浏览器"} | 超时: ${timeoutMs / 1000}s`);
  options.onProgress?.({ phase, bytes, timeoutMs });
  const requestStarted = performance.now();
  const res = await measureTransfer({ kind: phase === "publishing" ? "pointer" : "snapshot", transport: isTauriRuntime() ? "native" : "web", requestBytes: bytes }, () => githubApiFetch(url, {
    method: "PUT",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: payload,
    signal: options.signal,
  }, timeoutMs));
  const requestId = res.headers.get("x-github-request-id")?.replace(/[^a-zA-Z0-9:-]/g, "").slice(0, 128);
  addLog(`[Sync] PUT 响应: HTTP ${res.status} | 耗时: ${Math.round(performance.now() - requestStarted)}ms${requestId ? ` | GitHub 请求 ID: ${requestId}` : ""}`);
  if (!res.ok) {
    const err = await res.text();
    throw new GitHubWriteHttpError(res.status, `GitHub PUT ${res.status}: ${err.slice(0, 200)}\n失败阶段：${phase === "publishing" ? "发布最新备份" : "上传备份数据"}\n远端路径：${path}\n请求大小：${bytes} bytes${requestId ? `\nGitHub 请求 ID：${requestId}` : ""}`);
  }

  const text = await res.text();
  if (!text) {
    throw new Error("GitHub PUT 返回空响应体");
  }

  let data: { content: { sha: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GitHub PUT 返回非 JSON: ${text.slice(0, 200)}`);
  }

  if (!data?.content?.sha) {
    throw new Error(`GitHub PUT 返回数据缺少 content.sha`);
  }

  return data.content.sha;
}

/** Large uploads keep the exact JSON snapshot and existing latest CAS protocol. */
async function putLargeSnapshot(config: SyncConfig, path: string, content: string, message: string, options: PushOptions): Promise<void> {
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const request = async (route: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown): Promise<unknown> => {
    checkPushCancellation(options.signal);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const bytes = payload === undefined ? 0 : new TextEncoder().encode(payload).byteLength;
    const timeoutMs = bytes ? githubTransferTimeoutMs(bytes) : GITHUB_REQUEST_TIMEOUT_MS;
    options.onProgress?.({ phase: "uploading", bytes, timeoutMs });
    addLog(`[Sync] Git 数据接口 ${method} ${route || "仓库信息"} | 请求: ${bytes} bytes | 超时: ${timeoutMs / 1000}s`);
    const requestStarted = performance.now();
    const res = await measureTransfer({ kind: route === "/git/blobs" ? "blob" : "git-metadata", transport: isTauriRuntime() ? "native" : "web", requestBytes: bytes }, () => githubApiFetch(root + route, {
      method, headers: { ...authHeader(config.token), "Content-Type": "application/json" }, body: payload, signal: options.signal,
    }, timeoutMs));
    const requestId = res.headers.get("x-github-request-id")?.replace(/[^a-zA-Z0-9:-]/g, "").slice(0, 128);
    addLog(`[Sync] Git 数据接口响应: HTTP ${res.status} | 耗时: ${Math.round(performance.now() - requestStarted)}ms${requestId ? ` | GitHub 请求 ID: ${requestId}` : ""}`);
    if (!res.ok) throw new GitHubWriteHttpError(res.status, `GitHub ${method} ${route} ${res.status}: ${(await res.text()).slice(0, 200)}\n失败阶段：上传备份数据\n远端路径：${path}\n请求大小：${bytes} bytes${requestId ? `\nGitHub 请求 ID：${requestId}` : ""}`);
    return await res.json();
  };
  addLog(`[Sync] 大快照使用 Git 数据接口（UTF-8），不使用 Contents Base64 上传；原文: ${new TextEncoder().encode(content).byteLength} bytes`);
  await uploadLargeGitSnapshot(request, path, content, message, async () => {
    addLog("[Sync] 初始化空仓库的未发布数据路径；完成完整快照前不写 latest");
    await putRemote(config.token, config.owner, config.repo, path, "{}", null, `prepare: ${message}`, options);
  });
}

// ── 版本化路径工具 ──

/** 从基础路径推导时间戳数据文件路径 "base-20260715T123000.json" */
function versionedPath(basePath: string, version: string): string {
  const dot = basePath.lastIndexOf(".");
  if (dot === -1) return `${basePath}-${version}`;
  return `${basePath.slice(0, dot)}-${version}${basePath.slice(dot)}`;
}

/** 从基础路径推导 latest 指针文件路径 "base-latest"（纯文本，无后缀） */
function latestPath(basePath: string): string {
  const dot = basePath.lastIndexOf(".");
  if (dot === -1) return `${basePath}-latest`;
  return `${basePath.slice(0, dot)}-latest`;
}

/** 导出全量数据为 JSON 字符串（复用现有导出逻辑） */
async function exportFullDB(): Promise<string> {
  const { api } = await import("../api");
  const started = performance.now();
  try {
    const data = await api.export.data();
    addLog(`[Sync] 本机导出完成 | 耗时: ${Math.round(performance.now() - started)}ms`);
    return data;
  } catch (error) {
    addLog(`[Sync] 本机导出失败 | 耗时: ${Math.round(performance.now() - started)}ms`);
    throw error;
  }
}

/** 从 JSON 字符串导入全量数据 */
async function importFullDB(json: string, context: RestoreContext): Promise<void> {
  const { api } = await import("../api");
  console.log("[importFullDB] 开始导入, json 长度:", json.length);
  const result = await api.export.import(json, "replace", context);
  console.log("[importFullDB] 导入完成:", result);
}

/** 安全合并只 upsert 合并结果，不清空本地独有记录和版本历史。 */
async function importMergedDB(json: string, context: RestoreContext): Promise<void> {
  const { api } = await import("../api");
  console.log("[importMergedDB] 开始安全合并, json 长度:", json.length);
  const result = await api.export.import(json, "merge", context);
  console.log("[importMergedDB] 合并完成:", result);
}

function latestKnownBaseVersion(config: SyncConfig): string | null {
  const versions = [config.lastPullVersion, config.lastPushVersion]
    .filter((version): version is string => Boolean(version))
    .sort();
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export function remoteBackupNeedsMerge(config: SyncConfig, remoteVersion: string | null): boolean {
  const normalizedRemote = remoteVersion?.trim() ?? "";
  return Boolean(normalizedRemote && normalizedRemote !== latestKnownBaseVersion(config));
}

async function fetchBaseSnapshot(
  config: SyncConfig,
  remoteVersion: string,
  remoteContent: string,
): Promise<{ version: string | null; content: string | null }> {
  const version = latestKnownBaseVersion(config);
  if (!version) return { version: null, content: null };
  if (version === remoteVersion) return { version, content: remoteContent };
  try {
    const base = await fetchRemote(
      config.token,
      config.owner,
      config.repo,
      versionedPath(config.path, version),
    );
    if (!base) {
      addLog(`[Sync] 共同基线 ${version} 已不存在，改用保守冲突判断`);
      return { version: null, content: null };
    }
    return { version, content: base.content };
  } catch (reason) {
    addLog(`[Sync] 读取共同基线失败，改用保守冲突判断: ${syncErrorMessage(reason)}`);
    return { version: null, content: null };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Keep large workspaces diagnosable without flooding the bounded log buffer. */
function dumpBundle(label: string, json: string): void {
  addLog(`[Sync] ${label} | ${backupDiagnosticSummary(json)}`);
}

/**
 * Push: 本地 → GitHub（版本化）
 *
 * 写两个文件：
 *   1. {path}-{version}.json  — 全量数据快照（不可变，sha=null 即 create）
 *   2. {path}-latest           — 文本指针，内容为版本号（覆盖更新）
 */
export async function pushToGitHub(config: SyncConfig, message?: string, options: PushOptions = {}): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }

  await checkObservedProtocol(config);
  addLog("[Sync] ═══ Push → GitHub ═══");
  checkPushCancellation(options.signal);
  options.onProgress?.({ phase: "checking" });
  const ptrPath = latestPath(config.path);

  // Push 之前先确认本机确实见过远端 latest。否则旧设备可以直接把一个
  // 缺少远端新文档的全量快照设为 latest，历史文件虽仍在 GitHub，正常
  // Pull 却看不到它。要求先安全 Pull，形成并集后才允许继续 Push。
  let currentPointer: { content: string; sha: string } | null = null;
  try {
    currentPointer = await fetchRemote(config.token, config.owner, config.repo, ptrPath, options.signal);
  } catch (reason) {
    addLog(`[Sync] 读取 latest 指针失败: ${syncErrorMessage(reason)}`);
    throw reason;
  }
  const remoteVersion = currentPointer?.content.trim() ?? "";
  const knownBaseVersion = latestKnownBaseVersion(config);
  if (remoteBackupNeedsMerge(config, remoteVersion)) {
    addLog("[Sync] Push 预检拒绝：本机尚未接受远端版本；未开始上传，请先 Pull 安全合并");
    throw new Error(
      knownBaseVersion
        ? `远端备份已更新为 ${remoteVersion}，本机最近基线是 ${knownBaseVersion}。请先执行 Pull 安全合并，再重新 Push`
        : `远端已有备份 ${remoteVersion}，当前设备尚未合并。请先执行 Pull 安全合并，再重新 Push`,
    );
  }

  checkPushCancellation(options.signal);
  options.onProgress?.({ phase: "exporting" });
  const content = await exportFullDB();
  assertSyncCapabilities(JSON.parse(content), { operation: "write" });
  checkPushCancellation(options.signal);
  dumpBundle("导出本地数据", content);

  const version = new Date().toISOString().replace(/[:-]/g, "").replace(/\.(\d{3})Z$/, "$1"); // "20260715T123000123"
  const dataPath = versionedPath(config.path, version);

  // ── 1. 写数据文件（创建，sha=null）──
  addLog(`[Sync] 写入数据文件: ${dataPath}`);
  try {
    if (new TextEncoder().encode(content).byteLength >= GITHUB_LARGE_SNAPSHOT_BYTES) {
      await putLargeSnapshot(config, dataPath, content, message || `backup: ${version}`, options);
    } else {
      await putRemote(config.token, config.owner, config.repo, dataPath, content, null,
        message || `backup: ${version}`, options);
    }
  } catch (e) {
    addLog(`[Sync] 数据文件写入失败: ${syncErrorMessage(e)}`);
    throw e;
  }

  // ── 2. 写 latest 指针 ──
  addLog(`[Sync] 写入 latest 指针: ${ptrPath} → ${version}`);
  try {
    // 使用上传数据前读取的 SHA。如果此间另一台设备更新了 latest，GitHub
    // 会拒绝旧 SHA，避免竞态覆盖。
    await putRemote(config.token, config.owner, config.repo, ptrPath, version, currentPointer?.sha ?? null,
      `latest: ${version}`, options, "publishing");
  } catch (e) {
    addLog(`[Sync] latest 指针写入失败: ${syncErrorMessage(e)}`);
    throw e;
  }

  addLog(`[Sync] Push ✓ 完成 — ${config.owner}/${config.repo}/ 版本 ${version}`);
  addLog("");

  const updated = {
    ...config,
    lastSyncAt: new Date().toISOString(),
    lastPushVersion: version,
  };
  saveSyncConfig(updated);
  return updated;
}

/**
 * Pull: GitHub → 本地（版本化）
 *
 * 先读 {path}-latest 指针文件获取版本号 → 再拉对应版本的数据文件。
 */
export async function pullFromGitHub(config: SyncConfig, options: PullOptions = {}): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }
  await checkObservedProtocol(config);
  return withBackupRestore("github", options.mode === "replace" ? "replace" : "merge", (context) => pullWithRestoreLock(config, options, context));
}

async function pullWithRestoreLock(config: SyncConfig, options: PullOptions, context: RestoreContext): Promise<SyncConfig> {

  addLog("[Sync] ═══ Pull ← GitHub ═══");
  let restorePoint = await exportFullDB().catch((reason: unknown) => {
    throw backupError(reason, "失败阶段：本机导出恢复快照");
  });

  const ptrPath = latestPath(config.path);

  // ── 1. 读 latest 指针 ──
  addLog(`[Sync] 读取 latest 指针: ${ptrPath}`);
  const ptr = await fetchRemote(config.token, config.owner, config.repo, ptrPath);
  if (!ptr) {
    throw new Error(`远端仓库中未找到指针文件 ${ptrPath}`);
  }
  const version = ptr.content.trim();
  if (!version) {
    throw new Error("latest 指针文件为空");
  }
  if (options.expectedVersion && version !== options.expectedVersion) {
    throw new Error(`远端备份已从 ${options.expectedVersion} 更新为 ${version}，请重新预检后再导入\n新版本来源设备尚未读取，请以重新预检的结果为准`);
  }
  addLog(`[Sync] latest → 版本 ${version}`);

  // ── 2. 拉对应版本的数据 ──
  const dataPath = versionedPath(config.path, version);
  addLog(`[Sync] 拉取数据: ${dataPath}`);
  const remote = await fetchRemote(config.token, config.owner, config.repo, dataPath);
  if (!remote) {
    throw new Error(`远端仓库中未找到数据文件 ${dataPath}`);
  }

  addLog(`[Sync] 远端 SHA: ${remote.sha.slice(0, 7)}  |  大小: ${(new TextEncoder().encode(remote.content).length / 1024).toFixed(1)} KB`);

  validateRemoteBackup(remote.content, version);
  dumpBundle("拉取远端数据", remote.content);

  const mode = options.mode ?? "safe-merge";
  try {
    if (mode === "safe-merge") {
      const base = await fetchBaseSnapshot(config, version, remote.content);
      // Downloads may be slow. Include edits made while they were in flight,
      // and validate destructive conflict choices against this fresh snapshot.
      restorePoint = await exportFullDB();
      const merged = buildSafeMergedBackup(restorePoint, remote.content, base.content, options);
      addLog(
        `[Sync] 安全合并: 保留本地独有 ${merged.comparison.localOnly.length}，`
        + `导入远端独有 ${merged.comparison.remoteOnly.length}，`
        + `冲突副本 ${merged.conflictCopies}`,
      );
      await importMergedDB(merged.json, context);
    } else {
      await importFullDB(remote.content, context);
    }
  } catch (e) {
    // Validation/staging failures before mutation do not need a snapshot replay.
    // Nor may post-commit journal/notification errors undo a successful import.
    if (!context.mutationStarted) throw backupError(e, `远端版本：${version}\n远端备份来源：${formatBackupDevice(summarizeBackup(remote.content).backupDevice)}`);
    if (context.dataCommitted) throw new Error("数据已导入，但恢复收尾失败。请先导出并检查本地数据，勿直接重复 Pull。");
    context.setPhase("rolling-back");
    addLog(`[Sync] 导入失败，尝试恢复拉取前快照: ${syncErrorMessage(e)}`);
    try {
      // 安全合并失败时避免用 replace 清空本地版本历史；两端的记录写入
      // 本身都在事务中，merge 恢复足以还原已有记录与配置。
      if (mode === "safe-merge") await importMergedDB(restorePoint, context);
      else await importFullDB(restorePoint, context);
      addLog("[Sync] 已恢复拉取前本地快照");
    } catch (restoreError) {
      addLog(`[Sync] 恢复快照失败: ${syncErrorMessage(restoreError)}`);
      throw e;
    }
    throw e;
  }

  const bundle = JSON.parse(remote.content);
  addLog(`[Sync] Pull ✓ 完成（${mode === "safe-merge" ? "安全合并" : "全量覆盖"}）— 远端 ${bundle.notes?.length ?? 0} 文档`);
  addLog("[Sync] 刷新页面后生效");
  addLog("");

  const updated = {
    ...config,
    lastSyncAt: new Date().toISOString(),
    lastPullVersion: version,
  };
  saveSyncConfig(updated);
  return updated;
}

/** Read-only, fixed-revision protocol inspection for explicit migration preparation. */
export async function preflightProtocolFromGitHub(config: SyncConfig): Promise<RemoteProtocolReport> {
  if (!config.token || !config.owner || !config.repo) throw Error("请先配置 GitHub 连接");
  const started = performance.now();
  addLog("[Sync] 协议预检开始：固定远端提交，只读检查");
  try {
    const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    const storage = getWebStorage().localStorage;
    if (!storage) throw Error("本机协议记录不可用，不能确认预检");
    const report = await inspectRemoteProtocol(async route => {
      const response = await githubApiFetch(root + route, {headers:authHeader(config.token)}, GITHUB_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw Error(`协议预检读取失败：HTTP ${response.status}`);
      return response.json();
    }, config, {onControlDetected:spaceId=>markProtocolInspectionRequired(config,spaceId,storage)});
    await observeRemoteProtocol(report, storage);
    addLog(`[Sync] 协议预检完成 | 提交: ${report.evidence.head.slice(0,12)} | 状态: ${report.support} | 历史: ${report.history} | 请求: ${report.reads.requests} | 字节: ${report.reads.bytes} | 耗时: ${Math.round(performance.now()-started)}ms`);
    return report;
  } catch (error) {
    addLog(`[Sync] 协议预检未通过 | 耗时: ${Math.round(performance.now()-started)}ms`);
    throw error;
  }
}
async function checkObservedProtocol(config: SyncConfig): Promise<void> {
  const storage = getWebStorage().localStorage;
  if (storage) await assertLegacyConnectionAllowed(config, storage);
}

export async function previewPullFromGitHub(config: SyncConfig): Promise<PullPrecheck> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }
  await checkObservedProtocol(config);
  const ptrPath = latestPath(config.path);
  const [localSnapshot, ptr] = await Promise.all([
    exportFullDB().catch((reason: unknown) => {
      throw backupError(reason, "失败阶段：本机导出预检快照");
    }),
    fetchRemote(config.token, config.owner, config.repo, ptrPath).catch((reason: unknown) => {
      throw backupError(reason, `失败阶段：读取远端 latest 指针\n远端路径：${ptrPath}`);
    }),
  ]);
  if (!ptr) {
    throw new Error(`远端仓库中未找到指针文件 ${ptrPath}`);
  }
  const version = ptr.content.trim();
  if (!version) {
    throw new Error("latest 指针文件为空");
  }
  const dataPath = versionedPath(config.path, version);
  const remote = await fetchRemote(config.token, config.owner, config.repo, dataPath).catch((reason: unknown) => {
    throw backupError(reason, `失败阶段：下载远端备份快照\n远端版本：${version}\n远端路径：${dataPath}`);
  });
  if (!remote) {
    throw new Error(`远端仓库中未找到数据文件 ${dataPath}`);
  }
  const local = summarizeBackup(localSnapshot);
  const remoteSummary = summarizeBackup(remote.content);
  validateRemoteBackup(remote.content, version);
  const base = await fetchBaseSnapshot(config, version, remote.content);
  let comparison: BackupComparison;
  try {
    comparison = compareBackupSnapshots(localSnapshot, remote.content, base.content);
  } catch (reason) {
    throw backupError(reason, `失败阶段：快照比较\n本地快照来源：${formatBackupDevice(local.backupDevice)}\n远端版本：${version}\n远端备份来源：${formatBackupDevice(remoteSummary.backupDevice)}`);
  }
  return {
    local,
    remote: {
      ...remoteSummary,
      version,
      path: dataPath,
      ptrPath,
      sha: remote.sha,
    },
    comparison,
    baseVersion: base.version,
    remoteDocuments: extractRemoteDocumentPreviews(remote.content),
    localDocuments: extractRemoteDocumentPreviews(localSnapshot),
  };
}

/**
 * 检查连接状态：能否访问仓库，远端是否有备份
 * 仅做元数据检测（HTTP status），不下载文件内容
 */
export type SyncConnectionConfig = Pick<SyncConfig, "token" | "owner" | "repo" | "path" | "lastSyncAt">;

export async function checkStatus(config: SyncConnectionConfig): Promise<SyncStatus> {
  if (!config.token || !config.owner || !config.repo) {
    return { ok: false, message: "未配置" };
  }

  try {
    // Contents GET 只能证明 Token 有读取权限；Push 还需要 Contents write。
    // 先检查仓库权限，避免把只读 Token 误报为“连接正常”。
    const repoUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    const repoRes = await githubApiFetch(repoUrl, { headers: authHeader(config.token) });
    if (repoRes.status === 401) {
      return { ok: false, message: "Token 无效或无权限" };
    }
    if (!repoRes.ok) {
      const body = await repoRes.text().catch(() => "");
      return { ok: false, message: `仓库访问失败（API ${repoRes.status}）：${body.slice(0, 100)}` };
    }
    const repoData = await repoRes.json() as { permissions?: Record<string, boolean> };
    const permissions = repoData.permissions;
    if (permissions && !permissions.push && !permissions.maintain && !permissions.admin) {
      return {
        ok: false,
        message: "Token 仅有读取权限；请授予该仓库 Contents: Read and write（classic Token 需 repo scope）",
      };
    }

    // 检查 latest 指针文件是否存在
    const ptrPath = latestPath(config.path);
    const url = githubContentsUrl(config.owner, config.repo, ptrPath);
    const res = await githubApiFetch(url, { headers: authHeader(config.token) });
    if (res.status === 404) {
      return {
        ok: true,
        message: "仓库连接正常，远端暂无备份",
        localAt: config.lastSyncAt,
      };
    }
    if (res.status === 401) {
      return { ok: false, message: "Token 无效或无权限" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, message: `API ${res.status}: ${body.slice(0, 100)}` };
    }
    return {
      ok: true,
      message: "连接正常",
      localAt: config.lastSyncAt,
    };
  } catch (e) {
    return { ok: false, message: `连接失败: ${syncErrorMessage(e)}` };
  }
}
