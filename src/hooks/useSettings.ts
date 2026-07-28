/**
 * useSettings — 配置加载与主题管理。
 */
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { AppConfig } from "../lib/storage/types";
import { addLog } from "../lib/debugLog";
import { applyTheme } from "../lib/theme";

export function useSettings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 启动时加载配置并设置主题
  useEffect(() => {
    api.config.get().then((c) => {
      applyTheme(c.theme);
      addLog(`[启动] 九环 v${__APP_VERSION__} | 主题: ${c.theme}`);
      setConfig(c);
    });
  }, []);

  const handleConfigChange = (c: AppConfig) => {
    applyTheme(c.theme);
    setConfig(c);
  };

  return { config, settingsOpen, setSettingsOpen, handleConfigChange };
}
