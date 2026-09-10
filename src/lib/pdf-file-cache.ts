/** Immutable source bytes, never transfer this buffer to PDF.js directly. */
export class PdfFileCache {
  private entries = new Map<
    string,
    { bytes: ArrayBuffer; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    readonly budget = 64 * 1024 * 1024,
    private ttl = 120_000,
    private count = 3,
  ) {}

  get(key: string) {
    const value = this.entries.get(key);
    if (!value) return;
    this.remember(key, value.bytes);
    return value.bytes;
  }

  remember(key: string, bytes: ArrayBuffer) {
    this.delete(key);
    if (!bytes.byteLength || bytes.byteLength > this.budget) return;
    this.entries.set(key, {
      bytes,
      timer: setTimeout(() => this.delete(key), this.ttl),
    });
    while (
      this.entries.size > this.count ||
      [...this.entries.values()].reduce(
        (sum, entry) => sum + entry.bytes.byteLength,
        0,
      ) > this.budget
    ) {
      this.delete(this.entries.keys().next().value!);
    }
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  clear() {
    for (const key of this.entries.keys()) this.delete(key);
  }
}
