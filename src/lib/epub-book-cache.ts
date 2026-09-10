import type { ParsedEpub } from "./epub-library";

/** Archive data only: iframe documents and object URLs belong to each reader. */
export class EpubBookCache {
  private entries = new Map<
    string,
    { book: ParsedEpub; bytes: number; timer: ReturnType<typeof setTimeout> }
  >();
  private pending = new Map<string, Promise<ParsedEpub>>();

  constructor(
    private ttl = 120_000,
    private budget = 64 * 1024 * 1024,
    private count = 3,
  ) {}

  load(key: string, loader: () => Promise<ParsedEpub>): Promise<ParsedEpub> {
    const cached = this.entries.get(key);
    if (cached) {
      this.remove(key);
      this.keep(key, cached.book, cached.bytes);
      return Promise.resolve(cached.book);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = Promise.resolve()
      .then(loader)
      .then((book) => {
        if (this.pending.get(key) === task) {
          this.remember(key, book);
        }
        return book;
      })
      .finally(() => {
        if (this.pending.get(key) === task) this.pending.delete(key);
      });
    this.pending.set(key, task);
    return task;
  }

  /** Restart the retention window when a reader releases its active book. */
  remember(key: string, book: ParsedEpub) {
    const bytes = Object.values(book.files).reduce(
      (sum, file) => sum + file.byteLength,
      0,
    );
    this.remove(key);
    if (bytes <= this.budget) this.keep(key, book, bytes);
  }

  invalidate(key: string) {
    this.remove(key);
    this.pending.delete(key);
  }

  clear() {
    for (const key of this.entries.keys()) this.remove(key);
    this.pending.clear();
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  private keep(key: string, book: ParsedEpub, bytes: number) {
    const timer = setTimeout(() => this.remove(key), this.ttl);
    this.entries.set(key, { book, bytes, timer });
    while (
      this.entries.size > this.count ||
      [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) >
        this.budget
    ) {
      this.remove(this.entries.keys().next().value!);
    }
  }
}
