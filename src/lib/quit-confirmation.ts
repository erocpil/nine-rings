export const QUIT_CONFIRMATION_MS = 2000;

/** A second request within the hint window saves pending edits before exit. */
export function createQuitConfirmation(actions: {
  hint: () => void;
  clear: () => void;
  progress?: (phase: "saving" | "exiting") => void;
  save: () => Promise<void>;
  quit: () => Promise<void>;
  error: (error: unknown) => void;
  now?: () => number;
}) {
  let firstPress: number | null = null;
  let busy = false;
  const reset = () => { firstPress = null; };
  return {
    reset,
    async request() {
      if (busy) return;
      const now = actions.now?.() ?? performance.now();
      if (firstPress === null || now - firstPress >= QUIT_CONFIRMATION_MS) {
        firstPress = now;
        actions.hint();
        return;
      }
      reset();
      busy = true;
      if (actions.progress) actions.progress("saving");
      else actions.clear();
      try {
        await actions.save();
        actions.progress?.("exiting");
        await actions.quit();
        if (actions.progress) actions.clear();
      } catch (error) {
        actions.error(error);
      } finally {
        busy = false;
      }
    },
  };
}
