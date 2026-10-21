import { useEffect, useState, useSyncExternalStore } from "react";
import {
  blockWorkspacePreferences,
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  type StatusBarIdleGlowIntensity,
} from "../lib/block-display-settings";

const DEFAULT_IDLE_DELAY_SECONDS = 60;

function subscribePreference(listener: () => void) {
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreferences() {
  const preferences = blockWorkspacePreferences();
  return [
    preferences.statusBarIdleGlow === true,
    preferences.statusBarIdleDelaySeconds ?? DEFAULT_IDLE_DELAY_SECONDS,
    preferences.statusBarIdleGlowIntensity ?? "soft",
  ].join(":");
}

/** Starts a status-bar sheen after the configured foreground idle interval. */
export function useStatusBarIdleGlow(visible: boolean) {
  const snapshot = useSyncExternalStore(subscribePreference, readPreferences);
  const [enabledText, delayText, intensityText] = snapshot.split(":");
  const enabled = enabledText === "true";
  const delaySeconds = Number(delayText) || DEFAULT_IDLE_DELAY_SECONDS;
  const intensity = (intensityText === "balanced" || intensityText === "prominent"
    ? intensityText
    : "soft") as StatusBarIdleGlowIntensity;
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    setIdle(false);
    if (!visible || !enabled || typeof window.matchMedia !== "function") return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let foreground = document.visibilityState === "visible" && document.hasFocus();
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const reset = () => {
      clearTimer();
      setIdle(false);
      if (foreground && !reducedMotion.matches) {
        timer = setTimeout(() => setIdle(true), delaySeconds * 1_000);
      }
    };
    const onBlur = () => {
      foreground = false;
      reset();
    };
    const onFocus = () => {
      foreground = document.visibilityState === "visible";
      reset();
    };
    const onVisibilityChange = () => {
      foreground = document.visibilityState === "visible" && document.hasFocus();
      reset();
    };
    const onMotionChange = () => {
      if (reducedMotion.matches) {
        clearTimer();
        setIdle(false);
      } else {
        reset();
      }
    };

    const activityEvents: Array<[keyof WindowEventMap, AddEventListenerOptions?]> = [
      ["pointermove", { passive: true }],
      ["pointerdown", { passive: true }],
      ["keydown"],
      ["touchstart", { passive: true }],
      ["wheel", { passive: true }],
      ["scroll", { capture: true, passive: true }],
      ["focusin"],
    ];
    for (const [event, options] of activityEvents) {
      window.addEventListener(event, reset, options);
    }
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onMotionChange);
    reset();

    return () => {
      clearTimer();
      for (const [event, options] of activityEvents) {
        window.removeEventListener(event, reset, options);
      }
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [delaySeconds, enabled, visible]);

  return enabled && visible && idle ? intensity : null;
}
