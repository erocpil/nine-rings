import { useEffect, useRef } from "react";
import { localDateKey } from "../lib/local-date";
import { useNotesStore } from "../stores/useNotesStore";

export function useDateRollover(
  setDate: (date: string) => Promise<void>,
): void {
  const lastTodayRef = useRef(localDateKey());

  useEffect(() => {
    const dateId = window.setInterval(() => {
      const today = localDateKey();
      if (today === lastTodayRef.current) return;
      lastTodayRef.current = today;
      if (!useNotesStore.getState().selectedNote?.storagePath)
        void setDate(today);
    }, 30_000);
    return () => {
      window.clearInterval(dateId);
    };
  }, [setDate]);
}
