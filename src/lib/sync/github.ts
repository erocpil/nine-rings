/**
 * GitHub 同步服务 — 方案 A：全量 JSON 快照
 *
 * 数据流：
 *   Push: IndexedDB → 序列化 JSON → PUT /repos/{owner}/{repo}/contents/nine-rings-backup.json
 *   Pull: GET → 下载 JSON → 覆盖 IndexedDB
 *
 * 认证：个人访问令牌（Personal Access Token），需 repo 权限。
 * 设置 → 填入 token + owner/repo → 测试连接 → 手动/定时同步。
 */

import { addLog } from "../debugLog";

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

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { token: "", owner: "", repo: "", path: "nine-rings-backup.json", lastSyncAt: null, remoteSha: null, lastPushVersion: null, lastPullVersion: null };
}

export function saveSyncConfig(config: SyncConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── API 调用 ──

function authHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** 获取远端文件内容 + sha */
async function fetchRemote(token: string, owner: string, repo: string, path: string): Promise<{ content: string; sha: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: authHeader(token) });
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

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`GitHub API 返回非 JSON 内容: ${text.slice(0, 200)}`);
  }

  if (data.sha == null) {
    throw new Error(`GitHub API 返回数据缺少 sha 字段: ${JSON.stringify(Object.keys(data))}`);
  }

  // GitHub Contents API: 文件 >1MB 时不返回 base64 content
  const hasContent = data.content && data.content.length > 0 && data.encoding === "base64";
  console.log(`[fetchRemote] encoding=${data.encoding} contentLen=${data.content?.length ?? 0} size=${data.size}`);

  let decodedContent: string;

  if (hasContent) {
    // Push 侧用 btoa(unescape(encodeURIComponent(str))) 编码 UTF-8
    // Pull 侧必须对称解码: atob → escape → decodeURIComponent
    const binaryStr = atob(data.content);
    decodedContent = decodeURIComponent(escape(binaryStr));
  } else {
    // 大文件：用 Git Blobs API 拉取（无大小限制 + CORS 友好）
    console.log(`[fetchRemote] 文件 >1MB，用 Git Blobs API (sha=${data.sha.slice(0, 7)})`);
    const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${data.sha}`;
    const blobRes = await fetch(blobUrl, { headers: authHeader(token) });
    if (!blobRes.ok) {
      throw new Error(`Git Blobs API ${blobRes.status}`);
    }
    const blobData = await blobRes.json();
    if (!blobData.content || blobData.encoding !== "base64") {
      throw new Error("Git Blobs API 返回非 base64 内容");
    }
    const binaryStr = atob(blobData.content);
    decodedContent = decodeURIComponent(escape(binaryStr));
  }

  return { content: decodedContent, sha: data.sha };
}

/** 上传/更新远端文件 */
async function putRemote(token: string, owner: string, repo: string, path: string, content: string, sha: string | null, message: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // 正确处理 UTF-8
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT ${res.status}: ${err.slice(0, 200)}`);
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
  return await api.export.data();
}

/** 从 JSON 字符串导入全量数据 */
async function importFullDB(json: string): Promise<void> {
  const { api } = await import("../api");
  console.log("[importFullDB] 开始导入, json 长度:", json.length);
  const result = await api.export.import(json);
  console.log("[importFullDB] 导入完成:", result);
}

/** 树形 dump 导出数据摘要 + P.A.R.A. 文档树 */
function dumpBundle(label: string, json: string): void {
  let data: any;
  try { data = JSON.parse(json); } catch { addLog(`[Sync] ${label}: <非 JSON> ${json.slice(0, 80)}`); return; }

  const notes: any[] = data.notes ?? [];
  const pages: any[] = data.daily_pages ?? [];
  const sizeKB = (new TextEncoder().encode(json).length / 1024).toFixed(1);

  // 分类统计
  const docNotes  = notes.filter((n: any) => n.storagePath);
  const essays    = notes.filter((n: any) => !n.storagePath);
  const typeCount: Record<string, number> = {};
  for (const n of docNotes) {
    const dt = n.docType ?? "未设置";
    typeCount[dt] = (typeCount[dt] ?? 0) + 1;
  }

  addLog(`[Sync] ${label}`);
  addLog(`[Sync] ├─ 大小: ${sizeKB} KB  |  版本: ${data.version ?? "?"}  |  导出: ${(data.exported_at ?? "").slice(0, 19)}`);
  addLog(`[Sync] ├─ 笔记: ${notes.length} 篇  (文档 ${docNotes.length} + 随笔 ${essays.length})`);
  if (docNotes.length > 0) {
    const typeStr = Object.entries(typeCount).map(([k, v]) => `${k}:${v}`).join("  ");
    addLog(`[Sync] │  文档类型分布: ${typeStr}`);
  }

  // ── P.A.R.A. 文档树 ──
  if (docNotes.length > 0) {
    addLog(`[Sync] ├─ 📁 文档结构 (P.A.R.A.):`);
    dumpDocTree(docNotes);
  }

  // ── 随笔列表 ──
  if (essays.length > 0) {
    addLog(`[Sync] ├─ 📄 随笔 (${essays.length} 篇):`);
    const showEssays = essays.slice(0, 15);
    showEssays.forEach((n: any, i: number) => {
      const isLast = i === showEssays.length - 1;
      const prefix = isLast ? "└" : "├";
      const date = (n.date ?? "").slice(0, 10);
      const tags = n.tags?.length ? `  [${n.tags.join(", ")}]` : "";
      addLog(`[Sync] │  ${prefix}─ ${(n.id ?? "?").slice(0, 8)}  "${(n.title ?? "无标题").slice(0, 24)}"  ${date}${tags}`);
    });
    if (essays.length > 15) addLog(`[Sync] │  └─ ... 还有 ${essays.length - 15} 篇`);
  }

  addLog(`[Sync] ├─ 每日页面: ${pages.length} 页`);
  const showPages = pages.slice(0, 15);
  showPages.forEach((p, i) => {
    const isLast = i === showPages.length - 1;
    const prefix = isLast ? "└" : "├";
    const todoCount = Array.isArray(p.todos) ? p.todos.length : 0;
    addLog(`[Sync] │  ${prefix}─ ${p.date}  (${todoCount} todos)`);
  });
  if (pages.length > 15) addLog(`[Sync] │  └─ ... 还有 ${pages.length - 15} 页`);
  addLog("");
}

/** 按 storagePath 分组 dump P.A.R.A. 文档树 */
function dumpDocTree(docNotes: any[]): void {
  // 构建前缀树
  const tree = new Map<string, { folders: Set<string>; docs: any[] }>();
  for (const n of docNotes) {
    const root = n.storagePath.split("/")[0] || "(root)";
    if (!tree.has(root)) tree.set(root, { folders: new Set(), docs: [] });
    const entry = tree.get(root)!;
    entry.docs.push(n);
    // 收集子文件夹
    const parts = n.storagePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      entry.folders.add(parts.slice(0, i + 1).join("/"));
    }
  }

  const roots = [...tree.keys()].sort();
  roots.forEach((root, ri) => {
    const isLastRoot = ri === roots.length - 1;
    const rpfx = isLastRoot ? "└" : "├";
    const entry = tree.get(root)!;
    addLog(`[Sync] │  ${rpfx}─ 📁 ${root}/  (${entry.docs.length} 文档, ${entry.folders.size} 子目录)`);

    // 子目录
    const sortedFolders = [...entry.folders].sort();
    sortedFolders.forEach((folder, fi) => {
      const isLastF = fi === sortedFolders.length - 1;
      const fpfx = isLastRoot ? (isLastF ? " " : "│") : "│";
      const fpfx2 = isLastF ? "└" : "├";
      const subDocs = entry.docs.filter((n: any) =>
        n.storagePath === folder || n.storagePath.startsWith(folder + "/")
      ).length;
      const folderName = folder.split("/").pop()!;
      addLog(`[Sync] │  ${fpfx}   ${fpfx2}─ 📂 ${folderName}/  (${subDocs} 文档)`);
    });

    // 根级文档（storagePath 恰好等于 root）
    const rootDocs = entry.docs.filter((n: any) => n.storagePath === root);
    rootDocs.forEach((n: any, di: number) => {
      const isLastD = di === rootDocs.length - 1 && sortedFolders.length === 0;
      const dpfx = isLastRoot ? (isLastD ? " " : "│") : "│";
      const dpfx2 = isLastD ? "└" : "├";
      const dt = n.docType ? ` [${n.docType}]` : "";
      const concepts = n.concepts?.length ? `  🏷 ${n.concepts.join(", ")}` : "";
      addLog(`[Sync] │  ${dpfx}   ${dpfx2}─ 📄 ${(n.title ?? "无标题").slice(0, 28)}${dt}  ${(n.id ?? "?").slice(0, 6)}${concepts}`);
    });
  });
}

/**
 * Push: 本地 → GitHub（版本化）
 *
 * 写两个文件：
 *   1. {path}-{version}.json  — 全量数据快照（不可变，sha=null 即 create）
 *   2. {path}-latest           — 文本指针，内容为版本号（覆盖更新）
 */
export async function pushToGitHub(config: SyncConfig, message?: string): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }

  addLog("[Sync] ═══ Push → GitHub ═══");
  const content = await exportFullDB();
  dumpBundle("导出本地数据", content);

  const version = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+/, ""); // "20260715T123000"
  const dataPath = versionedPath(config.path, version);
  const ptrPath = latestPath(config.path);

  // ── 1. 写数据文件（创建，sha=null）──
  addLog(`[Sync] 写入数据文件: ${dataPath}`);
  try {
    await putRemote(config.token, config.owner, config.repo, dataPath, content, null,
      message || `backup: ${version}`);
  } catch (e) {
    addLog(`[Sync] 数据文件写入失败: ${(e as Error).message}`);
    throw e;
  }

  // ── 2. 写 latest 指针 ──
  addLog(`[Sync] 写入 latest 指针: ${ptrPath} → ${version}`);
  try {
    // 先获取 latest 的 SHA（可能不存在）
    let ptrSha: string | null = null;
    try {
      const ptr = await fetchRemote(config.token, config.owner, config.repo, ptrPath);
      ptrSha = ptr?.sha ?? null;
    } catch {
      // 文件不存在，null 即 create
    }
    await putRemote(config.token, config.owner, config.repo, ptrPath, version, ptrSha,
      `latest: ${version}`);
  } catch (e) {
    addLog(`[Sync] latest 指针写入失败: ${(e as Error).message}`);
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
export async function pullFromGitHub(config: SyncConfig): Promise<SyncConfig> {
  if (!config.token || !config.owner || !config.repo) {
    throw new Error("请先配置 GitHub Token、Owner 和 Repo");
  }

  addLog("[Sync] ═══ Pull ← GitHub ═══");

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
  addLog(`[Sync] latest → 版本 ${version}`);

  // ── 2. 拉对应版本的数据 ──
  const dataPath = versionedPath(config.path, version);
  addLog(`[Sync] 拉取数据: ${dataPath}`);
  const remote = await fetchRemote(config.token, config.owner, config.repo, dataPath);
  if (!remote) {
    throw new Error(`远端仓库中未找到数据文件 ${dataPath}`);
  }

  addLog(`[Sync] 远端 SHA: ${remote.sha.slice(0, 7)}  |  大小: ${(new TextEncoder().encode(remote.content).length / 1024).toFixed(1)} KB`);

  // 防御：验证拉取到的内容是有效 JSON
  if (!remote.content || !remote.content.trim()) {
    addLog("[Sync] 远端文件为空 — 跳过导入");
    const updated = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      lastPullVersion: version,
    };
    saveSyncConfig(updated);
    return updated;
  }
  try {
    JSON.parse(remote.content);
  } catch {
    throw new Error(`远端备份文件内容不是有效 JSON（前 100 字符: ${remote.content.slice(0, 100)}）`);
  }

  dumpBundle("拉取远端数据", remote.content);

  await importFullDB(remote.content);

  const bundle = JSON.parse(remote.content);
  addLog(`[Sync] Pull ✓ 完成 — 导入 ${bundle.notes?.length ?? 0} 笔记 + ${bundle.daily_pages?.length ?? 0} 页面`);
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

/**
 * 检查连接状态：能否访问仓库，远端是否有备份
 * 仅做元数据检测（HTTP status），不下载文件内容
 */
export async function checkStatus(config: SyncConfig): Promise<SyncStatus> {
  if (!config.token || !config.owner || !config.repo) {
    return { ok: false, message: "未配置" };
  }

  try {
    // 检查 latest 指针文件是否存在
    const ptrPath = latestPath(config.path);
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(ptrPath)}`;
    const res = await fetch(url, { headers: authHeader(config.token) });
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
    return { ok: false, message: `连接失败: ${(e as Error).message}` };
  }
}
