/** CSS theme token contract: every var() without a fallback must be defined. */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const definitions = new Set(
  Array.from(css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g), (match) => match[1]),
);
const unresolved = new Set<string>();

for (const match of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)(\s*,)?/g)) {
  const [, token, hasFallback] = match;
  if (!definitions.has(token) && !hasFallback) unresolved.add(token);
}

if (unresolved.size > 0) {
  console.error(`Undefined CSS theme tokens: ${Array.from(unresolved).sort().join(", ")}`);
  process.exit(1);
}

const graceBlock = css.match(/:root\.theme-grace\s*\{([^}]+)\}/)?.[1] ?? "";
for (const token of [
  "--bg",
  "--surface",
  "--border",
  "--text",
  "--text-secondary",
  "--accent",
  "--accent-hover",
  "--hover-bg",
  "--active-bg",
]) {
  if (!graceBlock.includes(`${token}:`)) {
    console.error(`Grace theme must explicitly define ${token}`);
    process.exit(1);
  }
}

console.log(`Theme contract passed (${definitions.size} tokens defined)`);
