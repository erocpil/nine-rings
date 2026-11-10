import type { BrowserToolContext } from "../../lib/local-files/browser-tool-context";
export interface WorkbenchTool { kind?: "command" | "separator"; execution?: "launch" | "capture"; id: string; name: string; command: string; arguments: string; hint: string; icon: { kind: "preset" | "unicode" | "image"; value: string } }
export const TOOLS_KEY = "custom-tools-v1";
export function validateWorkbenchTool(tool: WorkbenchTool) {
  if (!tool.name.trim() || tool.name.length > 80) throw new Error("工具名称须为 1～80 个字符。");
  if (tool.kind && !["command", "separator"].includes(tool.kind) || tool.execution && !["launch", "capture"].includes(tool.execution)) throw new Error("无效的工具类型或执行方式。");
  if (tool.kind !== "separator" && (!tool.command.trim() || tool.command.length > 4096 || /[\r\n\0]/.test(tool.command))) throw new Error("请输入有效的程序名称或完整路径，不要把参数写在命令中。");
  if (tool.arguments.length > 32768 || tool.arguments.split(/\r?\n/).filter(Boolean).length > 64 || tool.arguments.includes("\0")) throw new Error("最多 64 行参数，共 32768 个字符。");
  if (tool.hint.length > 256) throw new Error("提示信息最多 256 个字符。");
  if (!["preset", "unicode", "image"].includes(tool.icon.kind) || !tool.icon.value || tool.icon.value.length > 180000) throw new Error("请选择有效图标。");
  if (tool.icon.kind === "image" && !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(tool.icon.value)) throw new Error("图标只支持导入 PNG/JPEG/GIF/WebP 图片。");
  if (tool.icon.kind === "unicode" && Array.from(tool.icon.value).length > 16) throw new Error("Unicode 图标最多 16 个字符。");
}
export function parseWorkbenchTools(raw: string | null): WorkbenchTool[] {
  try {
    if (!raw || raw.length > 4 * 1024 * 1024) return [];
    const list: unknown = JSON.parse(raw); if (!Array.isArray(list) || list.length > 32) return [];
    const seen = new Set<string>();
    return list.filter((item): item is WorkbenchTool => { try { validateWorkbenchTool(item); if (typeof item.id !== "string" || !item.id || item.id.length > 80 || seen.has(item.id)) return false; seen.add(item.id); return true; } catch { return false; } });
  } catch { return []; }
}
export async function runWorkbenchTool(tool: WorkbenchTool, context: BrowserToolContext | null, operation?: "prepare" | "capture", expectedPlan?: PreparedTool) {
  validateWorkbenchTool(tool);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number | PreparedTool | ToolRun>("workbench_run_tool", { ...(operation ? { operation } : {}), ...(expectedPlan ? { expectedPlan } : {}), command: tool.command.trim(), arguments: tool.arguments.split(/\r?\n/).filter(line => line.length > 0), rootId: context?.rootId ?? null, node: context?.node ?? "", selected: [...(context?.selected ?? [])], targetRootId: context?.targetRootId ?? null, targetNode: context?.targetNode ?? null });
}

export function serializeWorkbenchTools(tools: WorkbenchTool[]) {
  if (tools.length > 32) throw new Error("最多添加 32 个工具。");
  for (const tool of tools) validateWorkbenchTool(tool);
  const raw = JSON.stringify(tools);
  if (raw.length > 4 * 1024 * 1024) throw new Error("工具配置过大，请使用较小的图标或减少工具数量。");
  return raw;
}

export interface PreparedTool { program: string; arguments: string[]; directory: string | null }
export interface ToolRun { id: number; pid: number }
export interface ToolResult { done: boolean; exited?: boolean; code: number | null; stdout: string; stderr: string; bytes: number; truncated: boolean; error: string | null }
export async function getToolResult(id: number) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ToolResult>("workbench_tool_status", { id });
}
export function displayToolCommand(plan: PreparedTool) {
  // JSON quoting describes exact argument boundaries on every platform; this is not shell source.
  return [plan.program, ...plan.arguments].map(value => JSON.stringify(value)).join(" ");
}

export async function stopTool(id: number) { const { invoke } = await import("@tauri-apps/api/core"); return invoke<void>("workbench_stop_tool", { id }); }
