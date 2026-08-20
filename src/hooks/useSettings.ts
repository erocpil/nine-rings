/**
 * useSettings — 配置加载与主题管理。
 */
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { AppConfig } from "../lib/storage/types";
import { addLog } from "../lib/debugLog";
import { applyTheme } from "../lib/theme";
import { withTimeout } from "../lib/async";

export function useSettings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 启动时加载配置并设置主题
  useEffect(() => {
    withTimeout(api.config.get(), 15000, "加载配置")
      .then(async (loaded) => {
        let c = loaded;
        // 旧版本的工具栏字号使用独立 localStorage。首次升级时迁入统一配置，
        // 之后设置页和工具栏始终读写同一个值。
        const legacyFontSize = Number(localStorage.getItem("nr:editorFontSize"));
        if (Number.isFinite(legacyFontSize) && legacyFontSize >= 12 && legacyFontSize <= 32) {
          c = await api.config.set({ note_font_size: legacyFontSize });
          localStorage.removeItem("nr:editorFontSize");
        }
        applyTheme(c.theme);
        addLog(`[启动] 九环 v${__APP_VERSION__} | 主题: ${c.theme}`);
        setConfig(c);
      })
      .catch((error) => {
        console.error("[useSettings] 配置加载失败:", error);
        addLog(`[启动] 配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
        // 让主界面继续可用；设置面板会显示“加载失败”并提供重试入口。
      });
  }, []);

  const handleConfigChange = (c: AppConfig) => {
    applyTheme(c.theme);
    setConfig(c);
  };

  return { config, settingsOpen, setSettingsOpen, handleConfigChange };
}
