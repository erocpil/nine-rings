import { suspendPluginWork } from "../lib/plugin-system/runtime";
import { useEffect, useRef } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { createQuitConfirmation, QUIT_CONFIRMATION_MS } from "../lib/quit-confirmation";
import { useTransientMessage } from "./useTransientMessage";

export function useQuitConfirmation(save: () => Promise<void>) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const { message, showMessage, clearMessage } = useTransientMessage();
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const confirmation = createQuitConfirmation({
      hint: () => showMessage("再次按下 ⌘Q 退出（2 秒内）", QUIT_CONFIRMATION_MS),
      clear: clearMessage,
      progress: phase => showMessage(phase === "saving" ? "正在保存并退出…" : "本机已保存，正在清理并退出…", 0),
      prepare: suspendPluginWork,
      save: () => saveRef.current(),
      quit: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("quit_application");
      },
      error: error => showMessage(`退出失败，应用仍保持打开：${error instanceof Error ? error.message : String(error)}`, "error"),
    });
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const off = await listen("nine-rings:confirm-quit", () => {
        if (!disposed) void confirmation.request();
      });
      if (disposed) off();
      else unlisten = off;
    }).catch(error => console.warn("[Quit] 注册退出确认失败:", error));
    const reset = () => { confirmation.reset(); clearMessage(); };
    window.addEventListener("blur", reset);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("blur", reset);
    };
  }, [showMessage, clearMessage]);
  return message;
}
