import type { LocalFileSnapshot } from "./file-model";

export interface DiskChange {
  id: string;
  name: string;
  path: string;
  disk: LocalFileSnapshot;
  dirty: boolean;
  later: boolean;
}

export interface DiskChangeActions {
  readCurrent(): string | Promise<string>;
  load(revision: string, discard?: boolean): Promise<boolean>;
  saveCopy?(): void;
  canOverwrite?(): boolean;
  overwrite?(): void;
}

export class DiskChanges {
  private changes: DiskChange[] = [];
  private listeners = new Set<() => void>();
  readonly actions = new Map<string, DiskChangeActions>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.changes;

  private update(changes: DiskChange[]) {
    this.changes = changes;
    for (const listener of this.listeners) listener();
  }

  record(change: Omit<DiskChange, "later">) {
    const existing = this.changes.find(item => item.id === change.id);
    const sameRevision = existing?.disk.revision === change.disk.revision;
    if (sameRevision && existing.dirty === change.dirty && existing.name === change.name && existing.path === change.path) return;
    const next = { ...change, later: sameRevision && existing.later };
    this.update(existing ? this.changes.map(item => item === existing ? next : item) : [...this.changes, next]);
  }

  clear(id: string) {
    if (this.changes.some(item => item.id === id)) this.update(this.changes.filter(item => item.id !== id));
  }

  defer() {
    this.update(this.changes.map(item => item.later ? item : { ...item, later: true }));
  }
}
