export const QUIT_CONFIRMATION_MS = 2000;

/** A second request within the hint window saves pending edits before exit. */
export function createQuitConfirmation(actions: {
  hint: () => void;
  clear: () => void;
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
      actions.clear();
      try {
        await actions.save();
        await actions.quit();
      } catch (error) {
        actions.error(error);
      } finally {
        busy = false;
      }
    },
  };
}
