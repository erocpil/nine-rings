/** Full Web AppConfig certification. No user storage access or default filling. */
import { DEFAULT_CONFIG, type AppConfig } from "../storage/types";
import { normalizePersistedConfig } from "../storage/db-config";
import { canonicalJson } from "./canonical-codec";

export const CERTIFIED_WEB_CONFIG_KEYS = [
  "hierarchy_path_mode",
  "hierarchy_path_custom_colors",
  "hierarchy_outline_mode",
  "hierarchy_outline_custom_colors",
  "interface_style",
  "workspace_layout",
  "exhibition_text_width",
  "exhibition_density",
  "interface_color_mode",
  "interface_font_family",
  "interface_font_size",
  "interface_line_height",
  "interface_block_spacing_px",
  "interface_heading_margin_top_px",
  "interface_heading_margin_bottom_px",
  "interface_content_width",
  "theme",
  "auto_clean_days",
  "note_font_size",
  "editor_font_family",
  "editor_line_height",
  "editor_block_spacing",
  "editor_block_number_gap",
  "editor_source_gutter_divider_width",
  "editor_source_gutter_divider_left_space",
  "editor_source_gutter_divider_right_space",
  "editor_h1_font_size",
  "editor_h2_font_size",
  "editor_h3_font_size",
  "editor_h4_font_size",
  "editor_h5_font_size",
  "editor_h6_font_size",
  "editor_code_font_family",
  "editor_quote_font_family",
  "editor_mermaid_font_family",
  "editor_flow_font_family",
  "editor_code_font_size",
  "editor_quote_font_size",
  "editor_mermaid_font_size",
  "editor_flow_font_size",
  "editor_paragraph_indent",
  "editor_heading_margin_top",
  "editor_heading_margin_bottom",
  "editor_list_margin_top",
  "editor_list_margin_bottom",
  "editor_list_indent",
  "editor_list_marker_gap",
  "editor_blockquote_indent",
  "editor_search_highlight_color",
  "navigation_font_size",
  "navigation_text_color",
  "navigation_background_color",
  "navigation_outline_font_size",
  "navigation_outline_text_color",
  "navigation_outline_background_color",
  "navigation_bookmark_font_size",
  "navigation_bookmark_text_color",
  "navigation_bookmark_background_color",
  "navigation_tree_font_size",
  "navigation_tree_text_color",
  "navigation_tree_background_color",
  "navigation_list_font_size",
  "navigation_list_text_color",
  "navigation_list_background_color",
  "editor_cjk_spacing",
  "dev_port",
  "highlight_active_line",
  "editor_show_line_numbers",
  "editor_fold_icon_style",
  "editor_fold_icon_collapsed",
  "editor_fold_icon_expanded",
  "editor_outline_fold_icon_style",
  "editor_fold_icon_overrides",
  "editor_show_status_block_number",
  "editor_show_status_bar",
  "editor_readonly_heading_fold",
  "editor_vim_mode",
  "editor_code_wrap_default",
  "use_custom_context_menu",
  "user_name",
  "user_organization",
  "user_email",
  "user_website",
  "user_copyright",
  "user_default_language",
  "user_default_license",
  "hotkeys",
] as const satisfies readonly (keyof AppConfig)[];

const enums: Partial<Record<keyof AppConfig, readonly (string | null)[]>> = {
  hierarchy_path_mode: ["off", "default", "custom"],
  hierarchy_outline_mode: ["off", "default", "custom"],
  interface_style: [
    "classic",
    "calm",
    "calm-compact",
    "paper",
    "minimal",
    "nine-rings",
    "mono-aware",
    "yugen",
    "wabi-sabi",
  ],
  workspace_layout: ["standard", "exhibition"],
  exhibition_text_width: ["narrow", "standard", "wide"],
  exhibition_density: ["comfortable", "compact"],
  interface_color_mode: ["light", "dark", "system"],
  theme: [
    "system",
    "light",
    "dark",
    "fu",
    "azure",
    "azure-dark",
    "grace",
    "sui",
    "zhi",
    "nord",
    "dracula",
  ],
  editor_fold_icon_style: ["chevron", "triangle", "custom"],
  editor_outline_fold_icon_style: [null, "triangle", "chevron", "inherit", "custom"],
};
const fonts = ["system", "sans", "serif", "monospace"];
const sensitive =
  /token|password|secret|credential|authorization|__proto__|constructor|prototype/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function isCertifiedWebAppConfig(input: unknown): input is AppConfig {
  if (!record(input)) return false;
  const keys = CERTIFIED_WEB_CONFIG_KEYS;
  // This additive preference was introduced after app-config-v1. Older
  // complete configs remain readable and inherit the empty override map.
  const legacyWithoutFoldOverrides =
    !Object.prototype.hasOwnProperty.call(input, "editor_fold_icon_overrides") &&
    Object.keys(input).length === keys.length - 1 &&
    keys.filter((key) => key !== "editor_fold_icon_overrides").every((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    );
  const hasInvalidKeySet =
    Object.keys(input).length !== keys.length - Number(legacyWithoutFoldOverrides) ||
    keys.some((key) =>
      !Object.prototype.hasOwnProperty.call(input, key) &&
      !(legacyWithoutFoldOverrides && key === "editor_fold_icon_overrides"),
    );
  if (hasInvalidKeySet) return false;
  for (const key of keys) {
    const value = key === "editor_fold_icon_overrides" && legacyWithoutFoldOverrides
      ? {}
      : input[key];
    const options = enums[key];
    if (key === "editor_fold_icon_overrides") {
      if (!isValidFoldIconOverrides(value)) return false;
    } else if (options) {
      if (!options.includes(value as string | null)) return false;
    } else if (key.endsWith("_font_family")) {
      const choices =
        key.startsWith("editor_") && !["editor_font_family"].includes(key)
          ? ["default", ...fonts]
          : fonts;
      if (typeof value !== "string" || !choices.includes(value)) return false;
    } else if (key === "hotkeys") {
      if (
        !record(value) ||
        Object.entries(value).some(
          ([name, binding]) =>
            sensitive.test(name) || typeof binding !== "string",
        )
      )
        return false;
    } else if (Array.isArray(DEFAULT_CONFIG[key])) {
      if (
        !Array.isArray(value) ||
        value.length !== 6 ||
        !value.every(
          (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
        )
      )
        return false;
    } else if (typeof value !== typeof DEFAULT_CONFIG[key]) return false;
    else if (typeof value === "number" && !Number.isFinite(value)) return false;
    else if (
      key.endsWith("_color") &&
      (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    )
      return false;
  }
  // Legacy palette/style migrations must not silently change a candidate's hash.
  const completeInput = { ...DEFAULT_CONFIG, ...input } as AppConfig;
  return canonicalJson(normalizePersistedConfig(completeInput)) === canonicalJson(completeInput);
}

function isValidFoldIconOverrides(value: unknown): boolean {
  if (!record(value)) return false;
  for (const [scope, raw] of Object.entries(value)) {
    if (scope !== "heading" && scope !== "block" && scope !== "outline") return false;
    if (!record(raw) || Object.keys(raw).some(key => !["style", "collapsed", "expanded"].includes(key))) return false;
    if (!["inherit", "chevron", "triangle", "custom"].includes(String(raw.style))) return false;
    for (const key of ["collapsed", "expanded"] as const) {
      const symbol = raw[key];
      if (symbol !== undefined && (typeof symbol !== "string" || Array.from(symbol).length > 8)) return false;
    }
  }
  return true;
}

const nativeFractionalFields = new Set([
  "interface_line_height",
  "editor_line_height",
  "editor_block_spacing",
  "editor_paragraph_indent",
  "editor_heading_margin_top",
  "editor_heading_margin_bottom",
  "editor_list_margin_top",
  "editor_list_margin_bottom",
  "editor_list_indent",
  "editor_list_marker_gap",
]);
function nativeString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
/** Serde's String cannot preserve lone UTF-16 surrogates; i32 fields cannot
 * accept fractional or out-of-range Web numbers. Refuse before native import. */
export function isCertifiedTauriAppConfig(input: unknown): input is AppConfig {
  if (!isCertifiedWebAppConfig(input)) return false;
  return Object.entries(input).every(([key, value]) => {
    if (typeof value === "number")
      return (
        nativeFractionalFields.has(key) ||
        (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
      );
    if (typeof value === "string") return nativeString(value);
    if (key === "hotkeys")
      return Object.entries(input.hotkeys).every(
        ([name, binding]) => nativeString(name) && nativeString(binding),
      );
    return true;
  });
}
