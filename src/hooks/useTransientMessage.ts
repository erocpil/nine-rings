import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MESSAGE_DURATION = 3200;
const ERROR_MESSAGE_DURATION = 8000;
const ERROR_PATTERN = /失败|错误|无法|不足|error/i;

type MessageSeverity = "info" | "success" | "warning" | "error";

type ShowMessageOptions = {
  durationMs?: number;
  severity?: MessageSeverity;
};

type ShowMessageInput = number | MessageSeverity | ShowMessageOptions | undefined;

function getTimeoutMs(message: string, input?: ShowMessageInput): number {
  if (typeof input === "number") return input;

  if (typeof input === "object" && input !== null) {
    if (typeof input.durationMs === "number") return input.durationMs;
    if (input.severity === "error") return ERROR_MESSAGE_DURATION;
    if (input.severity === "warning") return Math.max(DEFAULT_MESSAGE_DURATION, 5000);
    return DEFAULT_MESSAGE_DURATION;
  }

  if (typeof input === "string") {
    if (input === "error") return ERROR_MESSAGE_DURATION;
    if (input === "warning") return Math.max(DEFAULT_MESSAGE_DURATION, 5000);
    return DEFAULT_MESSAGE_DURATION;
  }

  if (ERROR_PATTERN.test(message)) return ERROR_MESSAGE_DURATION;

  return DEFAULT_MESSAGE_DURATION;
}

/** 可重复触发的临时反馈；新提示会取消旧计时器，避免被提前清除。 */
export function useTransientMessage() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMessage = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = null;
    setMessage(null);
  }, []);

  const showMessage = useCallback((next: string, durationOrOptions?: ShowMessageInput) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setMessage(next);
    const duration = getTimeoutMs(next, durationOrOptions);
    if (duration <= 0) {
      timerRef.current = null;
      return;
    }
    if (typeof setTimeout === "undefined") {
      timerRef.current = null;
      return;
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMessage(null);
    }, duration);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  return { message, showMessage, clearMessage };
}
