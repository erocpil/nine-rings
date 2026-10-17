/** Tab-local, bounded lifecycle evidence; no URLs, content or credentials. */
const key = "nr:pwa-update-events:v1";
const pendingKey = "nr:pwa-update-reload:v1";
const events = ["boot", "check", "apply", "reload"] as const;
type EventName = (typeof events)[number];
interface UpdateEvent {
  at: number;
  event: EventName;
  navigation: "navigate" | "reload" | "back_forward" | "unknown";
  opener: boolean;
  standalone: boolean;
  expectedReload: boolean;
}
export function readPwaUpdateDiagnostics(): UpdateEvent[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw || raw.length > 16_384) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(-20).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const v = value as UpdateEvent;
      if (
        !Number.isSafeInteger(v.at) ||
        !events.includes(v.event) ||
        !["navigate", "reload", "back_forward", "unknown"].includes(
          v.navigation,
        ) ||
        typeof v.opener !== "boolean" ||
        typeof v.standalone !== "boolean" ||
        typeof v.expectedReload !== "boolean"
      )
        return [];
      return [
        {
          at: v.at,
          event: v.event,
          navigation: v.navigation,
          opener: v.opener,
          standalone: v.standalone,
          expectedReload: v.expectedReload,
        },
      ];
    });
  } catch {
    return [];
  }
}
export function recordPwaUpdateEvent(event: EventName) {
  try {
    const now = Date.now();
    const pending = Number(window.sessionStorage.getItem(pendingKey));
    const navigation = (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type;
    const value: UpdateEvent = {
      at: now,
      event,
      navigation:
        navigation === "navigate" ||
        navigation === "reload" ||
        navigation === "back_forward"
          ? navigation
          : "unknown",
      opener: Boolean(window.opener),
      standalone:
        window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      expectedReload:
        pending > 0 && now >= pending && now - pending <= 10 * 60_000,
    };
    window.sessionStorage.setItem(
      key,
      JSON.stringify([...readPwaUpdateDiagnostics(), value].slice(-20)),
    );
    if (event === "reload")
      window.sessionStorage.setItem(pendingKey, String(now));
    else if (event === "boot") window.sessionStorage.removeItem(pendingKey);
  } catch {
    /* Diagnostics cannot block saving, activation or reload. */
  }
}
