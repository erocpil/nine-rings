/** CSS theme token contract: every var() without a fallback must be defined. */
import { readStylesheet } from "./css-source";

// Component styles share the same theme-token contract as application chrome.
const css = ["../src/styles.css", "../src/components/ReaderToolbar.css", "../src/components/RecycleBin.css"]
  .map((path) => readStylesheet(new URL(path, import.meta.url)))
  .join("\n");
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

for (const token of [
  "--ui-radius-small",
  "--ui-radius-medium",
  "--ui-radius-popover",
  "--ui-control-height",
  "--ui-icon-button-size",
  "--ui-panel-header-height",
  "--ui-panel-padding",
  "--ui-overlay",
  "--ui-shadow-popover",
  "--ui-shadow-dialog",
  "--ui-focus-ring",
]) {
  if (!definitions.has(token)) {
    console.error(`Shared application chrome must define ${token}`);
    process.exit(1);
  }
}

const sharedChrome = css.slice(css.lastIndexOf("Shared application chrome"));
for (const selector of [
  ".version-panel",
  ".recycle-panel",
  ".properties-panel",
  ".search-filter-btn",
  ".search-results-header",
  ".quick-switcher-item",
  ".pdf-reader-toolbar",
  ".reader-tool-panel",
]) {
  if (!sharedChrome.includes(selector)) {
    console.error(`Shared application chrome must cover ${selector}`);
    process.exit(1);
  }
}

for (const token of [
  "--syntax-keyword-color",
  "--syntax-string-color",
  "--syntax-value-color",
  "--syntax-meta-color",
  "--syntax-type-color",
]) {
  if (!definitions.has(token)) {
    console.error(`Syntax highlighting must define ${token}`);
    process.exit(1);
  }
}

const paperLight = css.match(/:root\[data-interface-style="paper"\]:not\(\.theme-dark\)[^{]*\{([^}]+)\}/)?.[1] ?? "";
const paperDark = css.match(/:root\[data-interface-style="paper"\]\.theme-dark[^{]*\{([^}]+)\}/)?.[1] ?? "";
for (const [name, palette, expected] of [
  ["paper light", paperLight, ["#93611f", "#386d46", "#346d91"]],
  ["paper dark", paperDark, ["#e5b65c", "#79c987", "#64cde0"]],
] as const) {
  if (!palette || expected.some((color) => !palette.toLowerCase().includes(color))) {
    console.error(`${name} must include the screenshot-inspired amber, green and blue palette`);
    process.exit(1);
  }
}

console.log(`Theme contract passed (${definitions.size} tokens defined)`);
