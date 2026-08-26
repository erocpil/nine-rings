import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MESSAGE_DURATION = 3200;
const ERROR_MESSAGE_DURATION = 8000;
const ERROR_PATTERN = /失败|错误|无法|不足|error/i;

/** 可重复触发的临时反馈；新提示会取消旧计时器，避免被提前清除。 */
export function useTransientMessage() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearMessage = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setMessage(null);
  }, []);

  const showMessage = useCallback((next: string, durationMs?: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setMessage(next);
    const duration = durationMs ?? (ERROR_PATTERN.test(next) ? ERROR_MESSAGE_DURATION : DEFAULT_MESSAGE_DURATION);
    if (duration <= 0) {
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMessage(null);
    }, duration);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { message, showMessage, clearMessage };
}
