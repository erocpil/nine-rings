import { createHash } from "node:crypto";
export class MeasurementError extends Error {}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function parseMeasureArgs(args) {
  const options = {
    maxPages: 10,
    details: false,
    fixture: null,
    history: null,
    branch: null,
    repository: null,
    pattern: /-\d{8}T\d{6}(?:\d{3})?\.json$/,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--details") options.details = true;
    else if (arg === "--json") {
      /* Reports are always JSON. */
    } else if (
      ["--fixture", "--history", "--branch", "--pattern", "--pages"].includes(
        arg,
      )
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new MeasurementError("选项缺少参数");
      if (arg === "--pages") {
        options.maxPages = Number(value);
        if (
          !Number.isInteger(options.maxPages) ||
          options.maxPages < 1 ||
          options.maxPages > 100
        )
          throw new MeasurementError("页数须为 1–100 的整数");
      } else if (arg === "--pattern") {
        if (value.length > 256) throw new MeasurementError("筛选表达式过长");
        try {
          options.pattern = new RegExp(value);
        } catch {
          throw new MeasurementError("筛选表达式无效");
        }
      } else options[arg.slice(2)] = value;
    } else if (!arg.startsWith("--") && !options.repository)
      options.repository = arg;
    else throw new MeasurementError("未知或重复参数");
  }
  if (!options.repository && options.fixture)
    options.repository = "fixture/backup";
  const parts = (options.repository ?? "").split("/");
  if (
    parts.length !== 2 ||
    parts.some(
      (p) => !identifier.test(p) || p === "." || p === ".." || p.length > 100,
    )
  )
    throw new MeasurementError(
      "请填写有效的 Owner/Repo，或使用 --fixture 文件",
    );
  return options;
}
function branchName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) ||
    value.includes("..") ||
    value.includes("@{") ||
    value.split("/").some((p) => !p || p.endsWith(".") || p.endsWith(".lock"))
  )
    throw new MeasurementError("分支名称无效");
  return value;
}
const sha = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new MeasurementError("GitHub 对象身份无效");
  return value;
};
export function liveRequester(token, fetchImpl = fetch) {
  const deadline = AbortSignal.timeout(120000);
  return async (path) => {
    if (!path.startsWith("/repos/") || /[\r\n]/.test(path))
      throw new MeasurementError("请求路径无效");
    let res;
    try {
      res = await fetchImpl(`https://api.github.com${path}`, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nine-rings-backup-measure",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new MeasurementError(
        "只读请求失败或超时；未重试，请检查网络和认证",
      );
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const error = new MeasurementError(
        `只读请求被拒绝（HTTP ${res.status}）；未重试`,
      );
      error.status = res.status;
      throw error;
    }
    try {
      return {
        data: await res.json(),
        next: /rel="next"/.test(res.headers.get("link") ?? ""),
      };
    } catch {
      throw new MeasurementError("只读响应不是有效 JSON");
    }
  };
}
export function fixtureRequester(fixture) {
  // No network and no credential handling in fixture mode.
  return async (path) => {
    const parsed = new URL(path, "https://fixture.invalid");
    const suffix = parsed.pathname.split("/").slice(4).join("/");
    let data;
    if (!suffix) data = fixture.repo;
    else if (suffix.startsWith("git/ref/heads/")) data = fixture.ref;
    else if (suffix.startsWith("git/commits/")) data = fixture.commit;
    else if (suffix.startsWith("git/trees/")) data = fixture.tree;
    else if (suffix === "commits") {
      const page = Number(parsed.searchParams.get("page"));
      return {
        data: fixture.commitPages?.[page - 1] ?? [],
        next: page < (fixture.commitPages?.length ?? 0),
      };
    } else if (suffix === "branches") data = fixture.branches ?? [];
    if (data === undefined) {
      const error = new MeasurementError("离线样本中无对应资源");
      error.status = 404;
      throw error;
    }
    return { data, next: false };
  };
}
export function estimateGrowth(current, history) {
  const valid = history.filter(
    (row) =>
      row?.scopeId === current.scopeId &&
      Number.isSafeInteger(row.repoSizeBytes) &&
      row.repoSizeBytes >= 0 &&
      Number.isFinite(Date.parse(row.observedAt)) &&
      Date.parse(row.observedAt) < Date.parse(current.observedAt),
  );
  valid.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const first = valid[0];
  if (
    !first ||
    Date.parse(current.observedAt) - Date.parse(first.observedAt) < 86400000
  )
    return {
      available: false,
      reason: "need-multiple-samples-at-least-one-day-apart",
    };
  const days =
    (Date.parse(current.observedAt) - Date.parse(first.observedAt)) / 86400000;
  const deltaBytes = current.repoSizeBytes - first.repoSizeBytes;
  if (deltaBytes < 0)
    return {
      available: false,
      reason: "server-size-decreased-or-history-changed",
    };
  return {
    available: true,
    days,
    deltaBytes,
    annualizedBytes: Math.round((deltaBytes / days) * 365),
    projectedThreeYearBytes: Math.round((deltaBytes / days) * 365 * 3),
    method: "server-size-linear-observation",
    confidence: "rough",
    assumptions: [
      "server-size-may-lag-and-includes-other-refs",
      "observed-growth-remains-constant",
      "not-git-pack-size-or-successful-push-count",
    ],
  };
}
export async function measureRepository(
  options,
  request,
  { now = new Date().toISOString(), history = [] } = {},
) {
  if (!Number.isFinite(Date.parse(now)))
    throw new MeasurementError("测量时间无效");
  const root = `/repos/${options.repository.split("/").map(encodeURIComponent).join("/")}`;
  const { data: repo } = await request(root);
  if (
    !Number.isSafeInteger(repo?.size) ||
    repo.size < 0 ||
    !Number.isSafeInteger(repo.size * 1024)
  )
    throw new MeasurementError("仓库大小统计无效");
  const branch = branchName(options.branch ?? repo.default_branch);
  const scopeId = createHash("sha256")
    .update(`${options.repository.toLowerCase()}\n${branch}`)
    .digest("hex")
    .slice(0, 24);
  const warnings = [];
  let ref;
  try {
    ref = (
      await request(
        `${root}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
      )
    ).data;
  } catch (error) {
    if (error.status !== 404 && error.status !== 409) throw error;
    const { data: branches } = await request(`${root}/branches?per_page=1`);
    if (!Array.isArray(branches) || branches.length || options.branch)
      throw new MeasurementError("所选分支不存在或不可读取");
    return {
      version: 1,
      scopeId,
      observedAt: now,
      repoSizeBytes: repo.size * 1024,
      empty: true,
      tree: { complete: true, files: 0, bytes: 0, snapshots: 0 },
      commits: { complete: true, sampled: 0 },
      growth: { available: false, reason: "empty-repository" },
    };
  }
  const head = sha(ref?.object?.sha);
  const { data: commit } = await request(`${root}/git/commits/${head}`);
  const { data: tree } = await request(
    `${root}/git/trees/${sha(commit?.tree?.sha)}?recursive=1`,
  );
  if (!Array.isArray(tree?.tree)) throw new MeasurementError("仓库树响应无效");
  const files = tree.tree.filter((entry) => entry?.type === "blob");
  if (
    files.some(
      (f) =>
        typeof f.path !== "string" ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0,
    )
  )
    throw new MeasurementError("仓库文件统计缺少大小或路径");
  const complete = tree.truncated === false;
  if (!complete) warnings.push("tree-incomplete-counts-are-lower-bounds");
  const snapshots = files.filter((f) => options.pattern.test(f.path));
  let commitsComplete = false,
    sampled = 0,
    invalidDates = 0,
    futureDates = 0;
  const dates = [];
  for (let page = 1; page <= options.maxPages; page++) {
    const { data: list, next } = await request(
      `${root}/commits?sha=${head}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(list)) throw new MeasurementError("提交列表响应无效");
    sampled += list.length;
    for (const entry of list) {
      const date = Date.parse(entry?.commit?.committer?.date);
      if (!Number.isFinite(date)) invalidDates++;
      else if (date > Date.parse(now)) futureDates++;
      else dates.push(date);
    }
    if (!next) {
      commitsComplete = true;
      break;
    }
  }
  if (!commitsComplete) warnings.push("commit-sample-incomplete");
  if (invalidDates || futureDates)
    warnings.push("commit-dates-incomplete-or-future");
  dates.sort((a, b) => a - b);
  const sum = (entries) =>
    entries.reduce((total, entry) => total + entry.size, 0);
  const result = {
    version: 1,
    scopeId,
    observedAt: now,
    repoSizeBytes: repo.size * 1024,
    repoSizeMeaning: "github-reported-kib-rounded-may-lag-not-branch-pack-size",
    empty: false,
    tree: {
      complete,
      lowerBound: !complete,
      files: files.length,
      bytes: sum(files),
      snapshots: snapshots.length,
      snapshotBytes: sum(snapshots),
      maxSnapshotBytes: snapshots.reduce((max, f) => Math.max(max, f.size), 0),
    },
    commits: {
      sampled,
      complete: commitsComplete,
      total: commitsComplete ? sampled : null,
      oldestObservedAt: dates.length ? new Date(dates[0]).toISOString() : null,
      newestObservedAt: dates.length
        ? new Date(dates[dates.length - 1]).toISOString()
        : null,
      invalidDates,
      futureDates,
      window90: {
        count: dates.filter((d) => d >= Date.parse(now) - 90 * 86400000).length,
        complete: commitsComplete && invalidDates === 0 && futureDates === 0,
      },
    },
    warnings,
    ...(options.details
      ? {
          details: {
            repository: options.repository,
            branch,
            largest: [...files]
              .sort((a, b) => b.size - a.size)
              .slice(0, 10)
              .map((f) => ({ path: f.path, bytes: f.size })),
          },
        }
      : {}),
  };
  return { ...result, growth: estimateGrowth(result, history) };
}
