export interface LinkViewPosition {
  rendered: boolean;
  from: number;
  to: number;
  top: number;
  left: number;
}

export interface LinkDestination {
  fragment?: string;
  start?: boolean;
  position?: LinkViewPosition;
}
export interface LinkRequest extends LinkDestination { serial: number }
interface Entry<T> extends LinkDestination { file: T }

/** A successful link records both ends. Ordinary tab selection leaves it alone. */
export class LinkHistory<T> {
  private entries: Entry<T>[] = [];
  private index = -1;

  get back() { return this.index > 0; }
  get forward() { return this.index + 1 < this.entries.length; }

  record(origin: Entry<T>, destination: Entry<T>, sameFile: (a: T, b: T) => boolean) {
    const before = this.entries.slice(0, this.index + 1);
    if (before.length && sameFile(before[before.length - 1].file, origin.file)) before[before.length - 1] = origin;
    else before.push(origin);
    this.entries = [...before, destination].slice(-100);
    this.index = this.entries.length - 1;
  }

  target(direction: -1 | 1) { return this.entries[this.index + direction]; }

  commit(direction: -1 | 1, origin: Entry<T> | undefined, sameFile: (a: T, b: T) => boolean) {
    const selected = this.entries[this.index];
    if (origin && selected && sameFile(origin.file, selected.file)) this.entries[this.index] = origin;
    this.index += direction;
  }
}
