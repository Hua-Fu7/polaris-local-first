import { THEME_PRESETS } from '../../../../config/theme/themePresets';
import type { ThemePreset } from '../../../../types/domain';

type RoomThemePresetSectionProps = {
  activePresetId: string | null;
  onApplyPreset: (presetId: string) => void;
};

// 手动换肤面板直接列全部预设：想换哪套点哪套，不用再让协作者去调主题工具。
const USER_THEME_PRESETS = THEME_PRESETS;

function presetSwatchColors(preset: ThemePreset) {
  const variables = preset.cssVariables as Record<string, string | undefined>;
  return [
    variables['--bg'],
    variables['--surface-solid'] ?? variables['--surface'],
    variables['--accent'],
    variables['--text']
  ].filter((color): color is string => Boolean(color?.trim()));
}

function presetHint(preset: ThemePreset) {
  const hint = preset.mood?.trim() || preset.description?.trim() || '';
  return hint.length > 34 ? `${hint.slice(0, 34)}…` : hint;
}

/** 主题 → 主题库：一键换肤。直接点，不用再让协作者去调主题工具。 */
export function RoomThemePresetSection({
  activePresetId,
  onApplyPreset
}: RoomThemePresetSectionProps) {
  return (
    <section className="theme-studio-section room-theme-preset-section">
      <div className="room-theme-preset-head">
        <strong>换肤</strong>
        <span>直接点一套就换上，不用再叫小机</span>
      </div>
      <div className="room-theme-preset-grid">
        {USER_THEME_PRESETS.map((preset) => {
          const active = preset.id === activePresetId;
          return (
            <button
              key={preset.id}
              type="button"
              className={`room-theme-preset-card ${active ? 'is-active' : ''}`}
              onClick={() => onApplyPreset(preset.id)}
              aria-pressed={active}
            >
              <span className="room-theme-preset-swatches" aria-hidden="true">
                {presetSwatchColors(preset).map((color, index) => (
                  <i key={`${preset.id}-${index}`} style={{ background: color }} />
                ))}
              </span>
              <strong>{preset.name}</strong>
              <small>{presetHint(preset)}</small>
              {active ? <em>当前</em> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}