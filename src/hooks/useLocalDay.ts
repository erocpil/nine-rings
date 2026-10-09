import { useEffect, useState } from "react";
import { localDateKey } from "../lib/local-date";

/** Local midnight and waking tabs update date-sensitive views without polling. */
export function useLocalDay() {
  const [day, setDay] = useState(localDateKey);
  useEffect(() => {
    let timer: number;
    const update = () => {
      clearTimeout(timer);
      const now = new Date();
      setDay(localDateKey(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = window.setTimeout(update, midnight.getTime() - now.getTime() + 25);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  return day;
}
