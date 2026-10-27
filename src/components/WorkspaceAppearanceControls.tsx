import { DocumentFilterSelect } from "./DocumentFilterSelect";
import { INTERFACE_STYLES } from "../lib/interface-style";
import type { AppConfig } from "../lib/storage/types";
import type { Dispatch, SetStateAction } from "react";

/** Shared choices and persistence patches for exhibition and focus titlebars. */
export function WorkspaceAppearanceControls({ config, desktop, disabled, open, onOpenChange, onChange, hoverOpens = false, onPopupEnter, onPopupLeave }: {
  config: AppConfig | null;
  desktop: boolean;
  disabled: boolean;
  open: string | null;
  onOpenChange: Dispatch<SetStateAction<string | null>>;
  onChange: (patch: Partial<AppConfig>) => void;
  hoverOpens?: boolean;
  onPopupEnter?: () => void;
  onPopupLeave?: () => void;
}) {
  const choose = (label: string, value: string, options: { value: string; label: string }[], patch: (value: string) => Partial<AppConfig>) =>
    <DocumentFilterSelect key={label} label={label} text={options.find(option => option.value === value)?.label ?? value}
      className="exhibition-select" value={value} options={options} disabled={disabled}
      open={open === label && !disabled}
      onOpenChange={next => onOpenChange(current => next ? label : current === label ? null : current)}
      onHover={desktop ? () => onOpenChange(current => hoverOpens || current !== null ? label : current) : undefined}
      onPopupEnter={onPopupEnter} onPopupLeave={onPopupLeave}
      popupPlacement={hoverOpens ? "left" : undefined} popupSizeToContent={hoverOpens}
      onChange={value => onChange(patch(value))} />;
  return <div className="exhibition-appearance">
    {choose("工作区风格", config?.interface_style === "calm-compact" ? "calm" : config?.interface_style ?? "calm",
      INTERFACE_STYLES.filter(style => style.value !== "classic"), value => ({ interface_style: value as AppConfig["interface_style"] }))}
    {choose("工作区配色", config?.interface_style === "classic" ? config.theme : config?.interface_color_mode ?? "system",
      [{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }],
      value => config?.interface_style === "classic" ? { theme: value as AppConfig["theme"] } : { interface_color_mode: value as AppConfig["interface_color_mode"] })}
    {desktop && <>
      {choose("文本宽度", config?.exhibition_text_width ?? "wide",
        [{ value: "narrow", label: "窄幅" }, { value: "standard", label: "标准" }, { value: "wide", label: "宽幅" }],
        value => ({ exhibition_text_width: value as AppConfig["exhibition_text_width"] }))}
      {choose("紧凑程度", config?.exhibition_density ?? "comfortable",
        [{ value: "comfortable", label: "舒适" }, { value: "compact", label: "紧凑" }],
        value => ({ exhibition_density: value as AppConfig["exhibition_density"] }))}
    </>}
  </div>;
}
