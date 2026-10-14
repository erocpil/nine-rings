/** Aggregate-only backup diagnostics. Never include document or device identifiers. */
export function backupDiagnosticSummary(source: string): string {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return "备份摘要: 非 JSON（未记录原始内容）";
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "备份摘要: 无效对象";
  const data = value as Record<string, unknown>;
  const count = (key: string) =>
    Array.isArray(data[key]) ? data[key].length : 0;
  let encrypted = 0;
  for (const item of Array.isArray(data.notes) ? data.notes : []) {
    if (!item || typeof item !== "object") continue;
    let body: unknown = item.content;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        continue;
      }
    }
    if (body && typeof body === "object" && "encrypted" in body) encrypted++;
  }
  const version =
    data.version === 1 || data.version === 2 ? data.version : "未知";
  return `备份摘要: ${new TextEncoder().encode(source).byteLength} bytes | 版本: ${version} | 文档: ${count("notes")} | 加密正文: ${encrypted} | 模板: ${count("templates")} | 保护路径: ${count("protected_paths")} | 保护历史: ${count("protected_versions")} | 封装头: ${Object.prototype.hasOwnProperty.call(data, "header") ? "存在" : "无"}`;
}
