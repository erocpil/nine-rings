import { startBuiltinVocabulary } from "../lib/plugin-system/builtin-vocabulary";
import { startBuiltinThemes } from "../lib/plugin-system/builtin-theme";
import { bookmarkDisplay } from "../lib/plugin-system/builtin-bookmark-display";
import { notesDisplay } from "../lib/plugin-system/builtin-notes-display";
import { applyInterfaceAppearance, formatInterfaceAppearanceLog, resolveInterfaceConfig } from "../lib/interface-style";
/**
 * useSettings — 配置加载与主题管理。
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { startBuiltinImageViewer } from "../lib/plugin-system/builtin-image-viewer";
import { outlineDisplay } from "../lib/plugin-system/builtin-outline-display";
import { startBuiltinTreeDisplay } from "../lib/plugin-system/builtin-tree-display";
import { startPluginRuntime } from "../lib/plugin-system/runtime";
import { api } from "../lib/api";
import type { AppConfig } from "../lib/storage/types";
import { addLog } from "../lib/debugLog";
import { withTimeout } from "../lib/async";
import { DEFAULT_EDITOR_APPEARANCE, BLOCK_TYPOGRAPHY_KEYS } from "../lib/editor-appearance";
import { preserveReadingPositions } from "../lib/reading-position";

export function useSettings() {
  useEffect(startPluginRuntime, []);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void import("../lib/plugin-system/editor-presentation-service").then(module => {
      if (!disposed) stop = module.startEditorPresentationService();
    });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(startBuiltinThemes, []);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void import("../lib/plugin-system/installed-packages").then(module => {
      if (!disposed) stop = module.startInstalledPluginPackages();
    }).catch(() => { /* A package loader failure leaves host/builtin resources intact. */ });
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(startBuiltinTreeDisplay, []);
  useEffect(() => outlineDisplay.start(), []);
  useEffect(() => bookmarkDisplay.start(), []);
  useEffect(() => notesDisplay.start(), []);
  useEffect(startBuiltinImageViewer, []);
  useEffect(startBuiltinVocabulary, []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 启动时加载配置并设置主题
  useEffect(() => {
    withTimeout(api.config.get(), 15000, "加载配置")
      .then(async (loaded) => {
        let c = loaded;
        // Ctrl+E 曾是聚焦全局搜索的默认键。升级时只迁移这个旧默认值，
        // 其他用户自定义组合保持不变。
        if (c.hotkeys?.focus_search === "CommandOrControl+E") {
          c = await api.config.set({
            hotkeys: { ...c.hotkeys, focus_search: "Alt+E" },
          });
        }
        // 旧版本的工具栏字号使用独立 localStorage。首次升级时迁入统一配置，
        // 之后设置页和工具栏始终读写同一个值。
        const legacyFontSize = Number(localStorage.getItem("nr:editorFontSize"));
        if (Number.isFinite(legacyFontSize) && legacyFontSize >= 12 && legacyFontSize <= 32) {
          c = await api.config.set({ note_font_size: legacyFontSize });
          localStorage.removeItem("nr:editorFontSize");
        }
        applyInterfaceAppearance(c);
        addLog(`[启动] 九环 v${__APP_VERSION__} | ${formatInterfaceAppearanceLog(c)}`);
        configRef.current = c;
        setConfig(c);
      })
      .catch((error) => {
        console.error("[useSettings] 配置加载失败:", error);
        addLog(`[启动] 配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
        // 让主界面继续可用；设置面板会显示“加载失败”并提供重试入口。
      });
  }, []);

  const handleConfigChange = (c: AppConfig) => {
    const previous = configRef.current;
    configRef.current = c;
    const appearanceIdentityChanged = !previous || c.interface_style !== previous.interface_style ||
      (c.interface_style === "classic" ? c.theme !== previous.theme : c.interface_color_mode !== previous.interface_color_mode);
    if (previous && appearanceIdentityChanged) addLog(`[外观] ${formatInterfaceAppearanceLog(c)}`);
    const styleChanged = !previous || c.interface_style !== previous.interface_style || c.interface_color_mode !== previous.interface_color_mode || c.workspace_layout !== previous.workspace_layout || c.exhibition_text_width !== previous.exhibition_text_width || c.exhibition_density !== previous.exhibition_density || c.interface_content_width !== previous.interface_content_width;
    if (styleChanged || c.theme !== previous?.theme) preserveReadingPositions(() => applyInterfaceAppearance(c));
    // 主题只由根节点 CSS 变量驱动。仅主题变化时无需让包含长文档的整个 App
    // React 树重新渲染；设置面板自身仍维护并持久化最新选择。
    if (previous && c.theme !== previous.theme) {
      const keys = Object.keys(c) as Array<keyof AppConfig>;
      const onlyThemeChanged = keys.every((key) => key === "theme" || c[key] === previous[key]);
      if (onlyThemeChanged) return;
    }
    const appearanceChanged = previous && ([...Object.keys(DEFAULT_EDITOR_APPEARANCE), ...BLOCK_TYPOGRAPHY_KEYS, "interface_font_family", "interface_font_size", "interface_line_height", "interface_block_spacing_px", "interface_heading_margin_top_px", "interface_heading_margin_bottom_px", "editor_block_number_gap"] as Array<keyof AppConfig>)
      .some(key => previous[key] !== c[key]);
    if (appearanceChanged || styleChanged) preserveReadingPositions(() => setConfig(c));
    else setConfig(c);
  };

  const displayConfig = useMemo(() => config ? resolveInterfaceConfig(config) : null, [config]);
  return { config: displayConfig, settingsOpen, setSettingsOpen, handleConfigChange };
}
