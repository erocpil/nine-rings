import features from "../workspace-features.json";

/** Temporary presentation switches, shared with the native tray.
 * Never use these to delete or omit backup data. */
export const DAILY_NOTES_ENABLED: boolean = features.dailyNotes;
export const TODOS_ENABLED: boolean = features.todos;

export function isWorkspaceShortcutEnabled(id: string): boolean {
  return DAILY_NOTES_ENABLED || !["new_note", "quick_capture", "go_to_daily"].includes(id);
}
