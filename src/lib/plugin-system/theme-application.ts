import { blockFontFamily } from "../editor-appearance";
import {
  preserveReadingPositions,
  READING_TYPOGRAPHY_WILL_CHANGE,
} from "../reading-position";
import {
  readThemePreference,
  subscribeThemePreference,
} from "./theme-preferences";
import { themeResources, type ThemeResource } from "./theme-resources";

const COLOR_VARIABLES = {
  bg: "--bg",
  surface: "--surface",
  border: "--border",
  text: "--text",
  muted: "--text-secondary",
  accent: "--accent",
  accentHover: "--accent-hover",
  hover: "--hover-bg",
  active: "--active-bg",
  code: "--code-bg",
  syntaxKeyword: "--syntax-keyword-color",
  syntaxString: "--syntax-string-color",
  syntaxValue: "--syntax-value-color",
  syntaxMeta: "--syntax-meta-color",
  syntaxType: "--syntax-type-color",
} as const;
export function themeResourceVariables(
  theme: ThemeResource,
  dark: boolean,
  typography: boolean,
  compact: boolean,
): Record<string, string> {
  const colors = dark ? theme.dark : theme.light;
  const variables: Record<string, string> = Object.fromEntries(
    Object.entries(COLOR_VARIABLES).map(([key, variable]) => [
      variable,
      colors[key as keyof typeof colors],
    ]),
  );
  Object.assign(variables, {
    "--drawer-surface": colors.surface,
    "--link-color": colors.accent,
    "--link-hover": colors.accentHover,
    "--accent-bg": colors.active,
    "--activeline-bg": `color-mix(in srgb, ${colors.accent} 10%, transparent)`,
  });
  if (typography && theme.typography) {
    const t = theme.typography;
    (compact ? t.compactHeadingScale : t.headingScale).forEach(
      (size, index) => {
        variables[`--editor-h${index + 1}-scale`] = String(size);
      },
    );
    for (const kind of ["code", "quote", "flow"] as const)
      variables[`--editor-${kind}-font-family`] = blockFontFamily(
        t[`${kind}Font`],
      )!;
  }
  return variables;
}

/** Host-only binding. It writes whitelisted variables, never plugin CSS or DOM. */
export function startThemeApplication() {
  const root = document.documentElement;
  const compact = window.matchMedia("(max-width: 768px)");
  const owned = new Map<
    string,
    { before: string; priority: string; value: string }
  >();
  let previous: Record<string, string> = {};
  let current: ThemeResource | null = null;
  let mode = "";
  const restore = () => {
    for (const [key, entry] of owned) {
      if (
        root.style.getPropertyValue(key) !== entry.value ||
        root.style.getPropertyPriority(key)
      )
        continue;
      if (entry.before)
        root.style.setProperty(key, entry.before, entry.priority);
      else root.style.removeProperty(key);
    }
    owned.clear();
  };
  const update = () => {
    const preference = readThemePreference();
    const theme = preference.enabled
      ? themeResources.get(preference.themeId)
      : null;
    // Keep the host's theme class authoritative, including classic named dark themes.
    const dark = [
      "theme-dark",
      "theme-azure-dark",
      "theme-nord",
      "theme-dracula",
    ].some((name) => root.classList.contains(name));
    const nextMode = `${dark}:${compact.matches}:${preference.typography}`;
    if (current === theme && mode === nextMode) return;
    current = theme;
    mode = nextMode;
    const next = theme
      ? themeResourceVariables(
          theme,
          dark,
          preference.typography,
          compact.matches,
        )
      : {};
    const typographyChanged = [
      ...new Set([...Object.keys(previous), ...Object.keys(next)]),
    ].some((key) => key.startsWith("--editor-") && previous[key] !== next[key]);
    const apply = () => {
      restore();
      for (const [key, value] of Object.entries(next)) {
        const before = root.style.getPropertyValue(key),
          priority = root.style.getPropertyPriority(key);
        root.style.setProperty(key, value);
        owned.set(key, {
          before,
          priority,
          value: root.style.getPropertyValue(key),
        });
      }
      if (theme) root.dataset.pluginTheme = theme.id;
      else delete root.dataset.pluginTheme;
    };
    if (typographyChanged) {
      window.dispatchEvent(new Event(READING_TYPOGRAPHY_WILL_CHANGE));
      preserveReadingPositions(apply);
    } else apply();
    previous = next;
  };
  const unsubscribeResources = themeResources.subscribe(update);
  const unsubscribePreference = subscribeThemePreference(update);
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  compact.addEventListener("change", update);
  update();
  return () => {
    observer.disconnect();
    unsubscribeResources();
    unsubscribePreference();
    compact.removeEventListener("change", update);
    const clear = () => {
      restore();
      delete root.dataset.pluginTheme;
    };
    if (Object.keys(previous).some((key) => key.startsWith("--editor-"))) {
      window.dispatchEvent(new Event(READING_TYPOGRAPHY_WILL_CHANGE));
      preserveReadingPositions(clear);
    } else clear();
  };
}
