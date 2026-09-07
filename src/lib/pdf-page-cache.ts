export interface CachedPdfPage {
  canvas: HTMLCanvasElement;
  signature: string;
  width: string;
  height: string;
}

/** Detached page bitmaps, bounded by both count and pixels (RGBA = pixels * 4).
 * Ownership transfers to the cache on put, and back to the caller on take. */
export class PdfPageCache {
  private pages = new Map<number, CachedPdfPage>();
  constructor(
    private maxPages = 6,
    private maxPixels = 12_000_000,
  ) {}

  put(page: number, entry: CachedPdfPage) {
    const previous = this.pages.get(page);
    if (previous && previous.canvas !== entry.canvas) this.release(previous);
    this.pages.delete(page);
    this.pages.set(page, entry);
    while (this.pages.size > this.maxPages || this.pixels > this.maxPixels) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.release(this.pages.get(oldest)!);
      this.pages.delete(oldest);
    }
  }

  peek(page: number): CachedPdfPage | undefined {
    const entry = this.pages.get(page);
    if (entry) {
      this.pages.delete(page);
      this.pages.set(page, entry);
    }
    return entry;
  }

  take(page: number, signature: string): CachedPdfPage | undefined {
    const entry = this.pages.get(page);
    if (!entry) return;
    this.pages.delete(page);
    if (entry.signature === signature) return entry;
    this.release(entry);
  }

  get pixels() {
    return [...this.pages.values()].reduce(
      (sum, entry) => sum + entry.canvas.width * entry.canvas.height,
      0,
    );
  }

  clear() {
    this.pages.forEach((entry) => this.release(entry));
    this.pages.clear();
  }
  private release(entry: CachedPdfPage) {
    entry.canvas.width = entry.canvas.height = 0;
  }
}
