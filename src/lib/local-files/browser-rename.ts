import { fileSegments, type FileNode } from "./file-model";

export interface BrowserRenameRules {
  template: string;
  start: number;
  padding: number;
  find: string;
  replacement: string;
  match: "text" | "regex";
  letterCase: "keep" | "lower" | "upper";
}

export const defaultBrowserRenameRules: BrowserRenameRules = {
  template: "{name}{ext}", start: 1, padding: 1, find: "", replacement: "", match: "text", letterCase: "keep",
};

export interface BatchRenameItem { node: string; name: string; next: string; changed: boolean; error?: string }

export function validateBrowserRenameRules(rules: BrowserRenameRules) {
  if (!rules.template || rules.template.length > 255 || /[{}]/.test(rules.template.replace(/\{(?:name|ext|n)\}/g, "")))
    throw new Error("命名模板仅支持 {name}、{ext}、{n} 占位符");
  if (!Number.isInteger(rules.start) || rules.start < 0 || rules.start > 1_000_000)
    throw new Error("起始编号须为 0–1000000 的整数");
  if (!Number.isInteger(rules.padding) || rules.padding < 1 || rules.padding > 12)
    throw new Error("编号位数须为 1–12 的整数");
  if (rules.find.length > 255 || rules.replacement.length > 255) throw new Error("查找和替换各限 255 字符");
  if (rules.match === "regex" && rules.find) {
    try { return new RegExp(rules.find, "gu"); }
    catch { throw new Error("正则表达式无效"); }
  }
}

export function previewBrowserRename(nodes: readonly string[], rules: BrowserRenameRules): BatchRenameItem[] {
  const regex = validateBrowserRenameRules(rules);
  if (!nodes.length || nodes.length > 2000 || new Set(nodes).size !== nodes.length)
    throw new Error("请选择不超过 2000 个不同项目");
  const rows = nodes.map((node, index) => {
    const parts = fileSegments(node);
    const name = parts[parts.length - 1];
    if (!name) throw new Error("请选择文件或目录");
    const at = name.lastIndexOf(".");
    let stem = at > 0 ? name.slice(0, at) : name;
    const ext = at > 0 ? name.slice(at) : "";
    if (regex) stem = stem.replace(regex, rules.replacement);
    else if (rules.find) stem = stem.split(rules.find).join(rules.replacement);
    if (rules.letterCase === "lower") stem = stem.toLowerCase();
    if (rules.letterCase === "upper") stem = stem.toUpperCase();
    const number = String(rules.start + index).padStart(rules.padding, "0");
    const next = rules.template.replace(/\{(name|ext|n)\}/g, (_, token: string) => token === "name" ? stem : token === "ext" ? ext : number);
    let error: string | undefined;
    try {
      if (next !== next.trim() || next.length > 255 || fileSegments(next).length !== 1) throw new Error();
    } catch { error = "目标名称无效"; }
    return { node, name, next, changed: next !== name, error };
  });
  const originalCounts = new Map<string, number>(), targetCounts = new Map<string, number>();
  for (const row of rows) {
    const original = row.name.toLowerCase(), target = row.next.toLowerCase();
    originalCounts.set(original, (originalCounts.get(original) ?? 0) + 1);
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }
  return rows.map(row => {
    const key = row.next.toLowerCase();
    const ownName = row.name.toLowerCase() === key ? 1 : 0;
    const error = row.error ?? ((targetCounts.get(key) ?? 0) > 1 ? "目标名称重复"
      : row.changed && (originalCounts.get(key) ?? 0) > ownName ? "目标被其他选中项占用" : undefined);
    return { ...row, error };
  });
}

export function markBrowserRenameConflicts(plan: readonly BatchRenameItem[], siblings: readonly FileNode[]): BatchRenameItem[] {
  const selected = new Set(plan.map(item => item.node));
  const occupied = new Set(siblings.filter(item => !selected.has(item.id)).map(item => item.name.toLowerCase()));
  return plan.map(item => item.changed && !item.error && occupied.has(item.next.toLowerCase())
    ? { ...item, error: "目标名称已被同目录项目占用" } : item);
}

export function planBrowserRename(nodes: readonly string[], template: string, start: number): BatchRenameItem[] {
  const plan = previewBrowserRename(nodes, { ...defaultBrowserRenameRules, template, start });
  const rejected = plan.find(item => item.error);
  if (rejected) throw new Error(`${rejected.error}：${rejected.next}`);
  return plan;
}
