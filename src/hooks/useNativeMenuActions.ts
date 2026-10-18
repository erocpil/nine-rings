import { useEffect, useLayoutEffect, useRef } from "react";
import { registerNativeMenuActions, unregisterNativeMenuActions, type NativeMenuAction } from "../lib/native-menu-registry";

/** Only active views register; hidden retained editors cannot receive commands. */
export function useNativeMenuActions(actions: Record<string, NativeMenuAction>, active = true) {
  const owner = useRef({});
  const token = owner.current;
  useLayoutEffect(() => {
    if (active) registerNativeMenuActions(token, actions);
    else unregisterNativeMenuActions(token);
  }, [actions, active, token]);
  useEffect(() => () => unregisterNativeMenuActions(token), [token]);
}
