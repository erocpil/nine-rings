import { SettingsVocabularyCorpora } from "./SettingsVocabularyCorpora";
import {
  defaultVocabularyListAppearance,
  readVocabularyPreference,
  saveVocabularyPreference,
  vocabularyListFonts,
  type VocabularyListAppearance,
} from "../lib/plugin-system/builtin-vocabulary";
import { Field } from "./SettingsFields";

export function SettingsVocabularyAppearance({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const preference = readVocabularyPreference();
  const save = (patch: Partial<VocabularyListAppearance>) => {
    saveVocabularyPreference({ ...readVocabularyPreference(), ...patch });
    onMessage("已更新");
  };
  return (
    <>
      <SettingsVocabularyCorpora onMessage={onMessage} />
      <Field
        label="列表字体"
        desc="仅影响左侧词汇列表；中央学习正文继续遵循排版设置。"
      >
        <select
          aria-label="列表字体"
          value={preference.listFont}
          onChange={(event) =>
            save({
              listFont: event.target
                .value as VocabularyListAppearance["listFont"],
            })
          }
        >
          {Object.entries(vocabularyListFonts).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {(
        [
          ["listFontSize", "列表字号", "px", 12, 28, 1],
          ["listLineHeight", "列表行高", "倍", 1.2, 2.4, 0.1],
          ["listRowHeight", "条目最小高度", "px", 28, 72, 1],
        ] as const
      ).map(([key, label, unit, min, max, step]) => (
        <Field key={key} label={label} desc={`${min}–${max} ${unit}`}>
          <input
            className="settings-input"
            type="number"
            aria-label={label}
            key={preference[key]}
            defaultValue={preference[key]}
            min={min}
            max={max}
            step={step}
            onBlur={(event) => {
              if (!event.target.value || !event.target.validity.valid) {
                event.target.value = String(readVocabularyPreference()[key]);
                onMessage(`请输入 ${min}–${max} 范围内的数值`);
                return;
              }
              save({ [key]: Number(event.target.value) });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </Field>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => save(defaultVocabularyListAppearance)}
      >
        恢复列表默认
      </button>
    </>
  );
}
