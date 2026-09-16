import { readFileSync } from "node:fs";

/** Follow the ordered local CSS imports so contracts inspect rules, not just the entry file. */
export function readStylesheet(url: URL, ancestors: string[] = []): string {
  if (ancestors.includes(url.href))
    throw new Error(`Circular CSS import: ${url.href}`);
  return readFileSync(url, "utf8").replace(
    /@import\s+["']([^"']+)["'];/g,
    (_, path: string) =>
      readStylesheet(new URL(path, url), [...ancestors, url.href]),
  );
}
