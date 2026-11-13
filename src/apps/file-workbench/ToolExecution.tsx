import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import type { BrowserToolContext } from "../../lib/local-files/browser-tool-context";
import { stopTool, displayToolCommand, getToolResult, runWorkbenchTool, type PreparedTool, type ToolResult, type ToolRun, type WorkbenchTool } from "./custom-tools";

type Session = { tool: WorkbenchTool; context: BrowserToolContext | null; plan?: PreparedTool; run?: ToolRun; result?: ToolResult; phase: "preparing" | "ready" | "running" | "done" | "error"; error?: string; started?: number; pid?: number };
/** One execution surface shared by the browser and editor toolbars. Closing it never starts or stops a process. */
export function useToolExecution(beforeRun: () => void) {
  const [session, setSession] = useState<Session | null>(null), [open, setOpen] = useState(false), [details, setDetails] = useState(false), [elapsed, setElapsed] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const phase = session?.phase;
  useLayoutEffect(() => {
    // Disabling Execute can move Chromium focus to body. Keep Escape routed to this dialog.
    if (open && phase && panel.current && !panel.current.closest(".workspace-dialog")?.contains(document.activeElement)) panel.current.focus({ preventScroll: true });
  }, [open, phase]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],dialog[open]')].filter(element => element.getClientRects().length);
      if (dialogs[dialogs.length - 1] !== panel.current?.closest(".workspace-dialog")) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open]);
  const current = useRef(session); current.current = session;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const execute = async (previous = current.current) => {
    if (!previous || previous.phase !== "ready") return;
    const next: Session = { ...previous, phase: "running", started: Date.now() };
    current.current = next; setSession(next); setElapsed(0);
    try {
      beforeRun();
      const result = await runWorkbenchTool(next.tool, next.context, next.tool.execution === "capture" ? "capture" : undefined, next.plan);
      if (!alive.current) return;
      if (typeof result === "number") setSession({ ...next, phase: "done", pid: result });
      else setSession({ ...next, run: result as ToolRun });
    } catch (error) { if (alive.current) { setSession({ ...next, phase: "error", error: String(error) }); setOpen(true); } }
  };
  const request = async (tool: WorkbenchTool, context: BrowserToolContext | null, direct = false) => {
    setOpen(!direct || tool.execution === "capture");
    if (current.current?.phase === "running" || current.current?.phase === "preparing") { setOpen(true); return; }
    const next: Session = { tool: { ...tool }, context: context ? { ...context, selected: [...context.selected] } : null, phase: "preparing" };
    current.current = next; setSession(next); setDetails(false);
    try { beforeRun(); const plan = await runWorkbenchTool(next.tool, next.context, "prepare") as PreparedTool; if (alive.current) { const ready: Session = { ...next, plan, phase: "ready" }; current.current = ready; setSession(ready); if (direct) await execute(ready); } }
    catch (error) { if (alive.current) { setSession({ ...next, phase: "error", error: String(error) }); setOpen(true); } }
  };
  useEffect(() => {
    if (session?.phase !== "running") return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [session?.phase]);
  const run = session?.run;
  useEffect(() => {
    if (!run || session?.phase !== "running") return;
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await getToolResult(run.id); if (!live) return; setSession(value => value?.run?.id === run.id ? { ...value, result, phase: result.done ? "done" : "running", error: undefined } : value); if (!result.done) timer = setTimeout(() => void poll(), 400); }
      catch (error) { if (live) { setSession(value => value?.run?.id === run.id ? { ...value, error: `读取进度失败，将重试：${String(error)}` } : value); timer = setTimeout(() => void poll(), 2000); } }
    };
    void poll(); return () => { live = false; clearTimeout(timer); };
  }, [run, session?.phase]);
  useEffect(() => {
    if (session?.phase !== "running" || !session.started) return;
    const started = session.started, timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [session?.phase, session?.started]);
  return { request, showLast: () => setOpen(true), hasResult: Boolean(session), element: open && session && <WorkspaceDialog title="工具执行" onClose={() => setOpen(false)}><div ref={panel} tabIndex={-1} className="workbench-tool-execution">
    <h3>{session.tool.name}</h3>
    {session.plan && <><label>完整命令（程序及各参数分别以引号表示）<pre tabIndex={0}>{displayToolCommand(session.plan)}</pre></label><p>工作目录：{session.plan.directory ?? "继承应用工作目录"}</p></>}
    <p role="status">{session.phase === "preparing" ? "正在解析所选文件与参数…" : session.phase === "ready" ? "确认后执行；程序直接接收参数，不经过 shell。" : session.phase === "running" ? `${session.result?.exited ? "进程已退出，等待输出关闭" : "正在执行"} · ${elapsed}s${session.result ? ` · 已接收 ${session.result.bytes} bytes` : ""}` : session.phase === "error" ? "执行失败" : session.pid ? `已启动 · PID ${session.pid}（应用独立运行，不捕获输出）` : session.result?.error ? "执行或输出读取失败" : session.result?.code === 0 ? "执行成功 · 退出码 0" : `执行结束 · 退出码 ${session.result?.code ?? "无（可能被信号终止）"}`}</p>
    {(session.error || session.result?.error) && <p role="alert">{session.error || session.result?.error}</p>}
    {session.run && <><button type="button" aria-expanded={details} onClick={() => setDetails(value => !value)}>{details ? "收起详细输出" : "查看详细输出"}</button>{details && <div className="workbench-tool-output">{session.result?.truncated && <p>输出过长，仅保留每个输出通道最后 128 KiB。</p>}<h4>标准输出</h4><pre tabIndex={0}>{session.result?.stdout || "（暂无输出）"}</pre><h4>标准错误</h4><pre tabIndex={0}>{session.result?.stderr || "（暂无输出）"}</pre></div>}</>}
    {session.phase === "running" && !session.result?.exited && session.run && <button type="button" onClick={() => { void stopTool(session.run!.id).catch(error => setSession(value => value ? { ...value, error: String(error) } : value)); }}>终止当前进程</button>}
    {session.phase === "running" && <p>关闭弹层后任务继续运行；终止只作用于当前进程，不会终止它创建的其它应用。</p>}
    <footer><button type="button" onClick={() => setOpen(false)}>关闭</button><button type="button" disabled={session.phase !== "ready"} onClick={() => void execute()}>执行</button></footer>
  </div></WorkspaceDialog> };
}
