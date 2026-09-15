import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const manifest = source("src-tauri/Cargo.toml");
const lock = JSON.parse(source("package-lock.json")) as {
  packages: Record<string, { version: string }>;
};

// With no committed Cargo.lock, a bare "2" permits Rust minor upgrades while
// npm ci keeps the JS side fixed. Catch that drift before the Windows build.
it.each([
  ["tauri", "api"],
  ["tauri-plugin-http", "plugin-http"],
  ["tauri-plugin-dialog", "plugin-dialog"],
  ["tauri-plugin-global-shortcut", "plugin-global-shortcut"],
])("keeps %s on the same minor release as its JS package", (crate, npm) => {
  const match = manifest.match(
    new RegExp(`^${crate}\\s*=\\s*(?:\\{\\s*version\\s*=\\s*)?"([^"]+)"`, "m"),
  );
  const version = lock.packages[`node_modules/@tauri-apps/${npm}`].version;
  const minor = version.split(".").slice(0, 2).join(".");
  expect(match?.[1]).toBe(`~${minor}`);
});
