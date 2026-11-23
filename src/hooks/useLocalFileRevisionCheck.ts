import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  LocalFileFingerprint,
  LocalFileSnapshot,
} from "../lib/local-files/file-model";

interface RevisionCheck {
  identity: string;
  enabled: boolean;
  background?: boolean;
  baseline(): LocalFileSnapshot | null;
  canCheck(): boolean;
  /** Null identifies a static snapshot. Omit stat for files with only a read capability. */
  stat?(): Promise<LocalFileFingerprint | null>;
  read(): Promise<LocalFileSnapshot>;
  onChecked(
    change: LocalFileSnapshot | null,
    baseline: LocalFileSnapshot,
  ): void;
  onError(cause: unknown): void;
}

// Serialize background reads so many open tabs cannot start a burst of file I/O.
let backgroundChecks = Promise.resolve();
function enqueueBackgroundCheck(check: () => Promise<void>) {
  backgroundChecks = backgroundChecks.then(check, check);
}

/** Check the disk revision without taking ownership of the editor buffer. */
export function useLocalFileRevisionCheck(options: RevisionCheck) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const { identity, enabled, background } = options;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let checking = false;
    let queuedFullCheck = false;
    let lastRead = 0;
    let observed: LocalFileFingerprint | undefined;

    const canCheck = () =>
      live &&
      latest.current.enabled &&
      latest.current.identity === identity &&
      document.visibilityState !== "hidden" &&
      latest.current.canCheck();

    const check = async (full = false) => {
      const baseline = latest.current.baseline();
      if (!baseline || !canCheck()) return;
      if (checking) {
        if (full) queuedFullCheck = true;
        return;
      }
      checking = true;
      const applicable = () =>
        canCheck() && latest.current.baseline() === baseline;
      try {
        const fingerprint = await latest.current.stat?.();
        if (!applicable() || fingerprint === null) return;
        const previous = observed ?? baseline;
        const metadataChanged =
          fingerprint &&
          (fingerprint.size !== previous.size ||
            fingerprint.modifiedMs !== previous.modifiedMs);
        if (!full && !metadataChanged && Date.now() - lastRead < 15_000) return;
        const next = await latest.current.read();
        if (!applicable()) return;
        observed = { size: next.size, modifiedMs: next.modifiedMs };
        lastRead = Date.now();
        latest.current.onChecked(
          next.revision === baseline.revision ? null : next,
          baseline,
        );
      } catch (cause) {
        if (applicable()) latest.current.onError(cause);
      } finally {
        checking = false;
        if (queuedFullCheck) {
          queuedFullCheck = false;
          void check(true);
        }
      }
    };

    let pending: number | undefined;
    let queued = false;
    let requestedFull = false;
    const schedule = (full: boolean) => {
      if (!background) { void check(full); return; }
      requestedFull ||= full;
      if (pending !== undefined || queued) return;
      pending = window.setTimeout(() => {
        pending = undefined;
        queued = true;
        enqueueBackgroundCheck(async () => {
          queued = false;
          const fullCheck = requestedFull;
          requestedFull = false;
          if (document.hasFocus()) await check(fullCheck);
        });
      }, 350);
    };
    const resume = () => schedule(true);
    const activation = window.setTimeout(() => {
      if (document.hasFocus()) resume();
    }, 0);
    const timer = window.setInterval(() => {
      schedule(false);
    }, background ? 5000 : 3000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      live = false;
      window.clearTimeout(activation);
      window.clearTimeout(pending);
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [identity, enabled, background]);
}
