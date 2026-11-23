import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import {
  extractBrowserZipEntry,
  indexBrowserZip,
} from "../../src/lib/local-files/browser-zip";

it("synthesizes omitted directories and extracts store and deflate entries", () => {
  const data = zipSync({
    "docs/guide.txt": strToU8("正文\n".repeat(500)),
    "raw.dat": [Uint8Array.of(0, 255), { level: 0 }],
  });
  const entries = indexBrowserZip(data);
  expect(entries.map((entry) => [entry.path, entry.directory])).toEqual([
    ["docs", true],
    ["docs/guide.txt", false],
    ["raw.dat", false],
  ]);
  expect(
    new TextDecoder().decode(extractBrowserZipEntry(data, entries[1])),
  ).toBe("正文\n".repeat(500));
  expect([...extractBrowserZipEntry(data, entries[2])]).toEqual([0, 255]);
});

it("rejects traversal, ambiguous directory paths, and corrupted bytes", () => {
  for (const path of ["../bad.txt", "/absolute.txt", "C:/drive.txt"]) {
    expect(() =>
      indexBrowserZip(zipSync({ [path]: strToU8("bad") })),
    ).toThrow();
  }
  expect(() =>
    indexBrowserZip(zipSync({ docs: strToU8(""), "docs/a": strToU8("a") })),
  ).toThrow("路径冲突");
  const data = zipSync({ file: strToU8("expected") }, { level: 0 });
  const [entry] = indexBrowserZip(data);
  data[entry.offset] = 0;
  expect(() => extractBrowserZipEntry(data, entry)).toThrow("CRC");
  expect(() => indexBrowserZip(data.slice(0, -1))).toThrow("完整");
});
