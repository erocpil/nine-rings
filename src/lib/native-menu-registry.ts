export interface NativeMenuAction { run: () => unknown; enabled?: boolean; checked?: boolean; shortcut?: boolean }
type Actions = Record<string, NativeMenuAction>;
const scopes = new Map<object, Actions>();
const subscribers = new Set<() => void>();
let blocked = false;
const notify = () => subscribers.forEach(listener => listener());
export function registerNativeMenuActions(owner: object, actions: Actions) {
  scopes.set(owner, actions);
  notify();
  return () => { if (scopes.get(owner) === actions && scopes.delete(owner)) notify(); };
}
export function unregisterNativeMenuActions(owner: object) { if (scopes.delete(owner)) notify(); }
export function blockNativeMenu(value: boolean) { if (blocked !== value) { blocked = value; notify(); } }
export function nativeMenuSnapshot() {
  const actions = Object.assign({}, ...scopes.values()) as Actions;
  return Object.entries(actions).map(([id, action]) => ({ id, enabled: !blocked && action.enabled !== false, checked: action.checked ?? false, ...(action.shortcut === false ? { shortcut: false } : {}) }));
}
export function runNativeMenuAction(id: string) {
  if (typeof id !== "string") return;
  const action = [...scopes.values()].reverse().find(scope => Object.prototype.hasOwnProperty.call(scope, id))?.[id];
  if (!blocked && action?.enabled !== false) return action?.run();
}
export function subscribeNativeMenu(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
