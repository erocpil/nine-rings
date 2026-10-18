import { useEditorCommandShortcuts } from "./useEditorCommandShortcuts";
import { useEffect, useLayoutEffect, useRef } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { blockNativeMenu } from "../lib/native-menu-registry";

export function useNativeMenuHost(blocked: boolean, onError: (error: string) => void) {
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEditorCommandShortcuts(error => errorRef.current(`快捷键操作失败：${String(error)}`));
  useLayoutEffect(() => { blockNativeMenu(blocked); }, [blocked]);
  useEffect(() => () => blockNativeMenu(false), []);
  useEffect(() => {
    if (!isTauriRuntime() || !/Mac/.test(navigator.platform)) return;
    let disposed = false, stop: (() => void) | undefined;
    void import("../lib/native-menu-service").then(async ({ startNativeMenuService }) => {
      const cleanup = await startNativeMenuService(error => errorRef.current(`菜单操作失败：${String(error)}`));
      if (disposed) cleanup(); else stop = cleanup;
    }).catch(error => console.warn("[Menu] 初始化系统菜单失败", error));
    return () => { disposed = true; stop?.(); };
  }, []);
}
