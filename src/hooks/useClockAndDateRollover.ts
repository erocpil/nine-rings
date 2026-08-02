import { useEffect, useRef, useState } from "react";
import { localDateKey } from "../lib/local-date";
import { useNotesStore } from "../stores/useNotesStore";

function currentClock(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function useClockAndDateRollover(
  setDate: (date: string) => Promise<void>,
): string {
  const [clock, setClock] = useState(currentClock);
  const lastTodayRef = useRef(localDateKey());

  useEffect(() => {
    const clockId = window.setInterval(() => setClock(currentClock()), 1_000);
    const dateId = window.setInterval(() => {
      const today = localDateKey();
      if (today === lastTodayRef.current) return;
      lastTodayRef.current = today;
      if (!useNotesStore.getState().selectedNote?.storagePath)
        void setDate(today);
    }, 30_000);
    return () => {
      window.clearInterval(clockId);
      window.clearInterval(dateId);
    };
  }, [setDate]);

  return clock;
}
