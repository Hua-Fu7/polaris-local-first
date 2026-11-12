import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ThemeState } from '../../../../types/domain';

type RoomThemeTuneSectionProps = {
  theme: ThemeState;
  onChangeCustomCSS: (css: string) => void;
  onSaveCurrentSkin: () => void;
};

type SkinField = 'userBubble' | 'assistantBubble' | 'background';
type SkinOverrideKey = 'userBubbleOverride' | 'assistantBubbleOverride' | 'backgroundOverride';

type SkinState = {
  userBubble: string;
  assistantBubble: string;
  background: string;
  bubbleOn: boolean;
  assistantBubbleOn: boolean;
  userBubbleOverride: boolean;
  assistantBubbleOverride: boolean;
  assistantBubbleVisibilityOverride: boolean;
  backgroundOverride: boolean;
  bubbleOverride: boolean;
};

type PickerState = {
  field: SkinField;
  hue: number;
  saturation: number;
  value: number;
  hex: string;
};

const BLOCK_START = '/* polaris:manual-appearance:start */';
const BLOCK_END = '/* polaris:manual-appearance:end */';
const BUBBLE_PRESETS = ['#e5628a', '#5b8def', '#34c759', '#a78bfa', '#ff9f43', '#3a3a3c', '#f2f2f4', '#ffffff'];
const BG_PRESETS = ['#ffffff', '#f5f5f7', '#fdeef2', '#eaf1ff', '#eaf7ee', '#1c1c1e', '#0b1220', '#000000'];

const FIELD_CONFIG = [
  { id: 'userBubble', label: '我的气泡', presets: BUBBLE_PRESETS, needBubble: true },
  { id: 'assistantBubble', label: '对方气泡', presets: BUBBLE_PRESETS, needBubble: true },
  { id: 'background', label: '背景颜色', presets: BG_PRESETS, needBubble: false }
] as const satisfies ReadonlyArray<{
  id: SkinField;
  label: string;
  presets: readonly string[];
  needBubble: boolean;
}>;

const OVERRIDE_KEY_BY_FIELD: Record<SkinField, SkinOverrideKey> = {
  userBubble: 'userBubbleOverride',
  assistantBubble: 'assistantBubbleOverride',
  background: 'backgroundOverride'
};

const MARKER = {
  background: '/* polaris:manual-appearance:background */',
  userBubble: '/* polaris:manual-appearance:user-bubble */',
  assistantBubble: '/* polaris:manual-appearance:assistant-bubble */',
  bubble: '/* polaris:manual-appearance:bubble-visibility */',
  assistantVisibility: '/* polaris:manual-appearance:assistant-bubble-visibility */'
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function expandHex(value: string) {
  const short = value.trim().replace('#', '').toLowerCase();
  if (short.length !== 3) return `#${short}`;
  return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
}

function firstHexColor(value: string | undefined, fallback: string) {
  const raw = value?.trim();
  if (!raw) return fallback;
  const hex = raw.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return expandHex(hex[0]);
  const rgb = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    const toHex = (part: string) => Number(part).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return fallback;
}

function readableTextColor(hex: string) {
  const value = expandHex(hex).replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return '#111111';
  const luminance = [red, green, blue]
    .map((part) => part / 255)
    .map((part) => (part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4))
    .reduce((total, part, index) => total + part * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.45 ? '#111111' : '#ffffff';
}

function hsvToHex(hue: number, saturation: number, value: number) {
  const channel = (offset: number) => {
    const key = (offset + hue / 60) % 6;
    return value - value * saturation * Math.max(0, Math.min(key, 4 - key, 1));
  };
  return `#${[channel(5), channel(3), channel(1)]
    .map((part) => Math.round(part * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const value = expandHex(hex).replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  return [(hue * 60 + 360) % 360, max ? delta / max : 0, max];
}

function stripManagedBlock(css: string) {
  const start = css.indexOf(BLOCK_START);
  const end = css.indexOf(BLOCK_END);
  if (start < 0 || end < start) return css.trim();
  return (css.slice(0, start) + css.slice(end + BLOCK_END.length)).trim();
}

function readManagedCssValue(css: string, property: string) {
  if (!css) return undefined;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, 'i'));
  return match?.[1]?.trim();
}
function resolveInitialSkin(theme: ThemeState): SkinState {
  const variables = theme.cssVariables as Record<string, string | undefined>;
  const managedBlock = theme.customCSS?.includes(BLOCK_START) ? theme.customCSS : '';
  const managedUserFill =
    readManagedCssValue(managedBlock, '--chat-bubble-user-fill')
    ?? readManagedCssValue(managedBlock, '--bubble-user');
  const managedAssistantFill = readManagedCssValue(managedBlock, '--chat-bubble-assistant-fill');
  const managedAssistantPadding = readManagedCssValue(managedBlock, '--chat-bubble-assistant-padding');
  const managedAssistantBorder = readManagedCssValue(managedBlock, '--chat-bubble-assistant-border');
  const baseAssistantFill = variables['--chat-bubble-assistant-fill']?.trim() ?? '';
  const baseAssistantPadding = variables['--chat-bubble-assistant-padding']?.trim() ?? '';
  const baseAssistantBorder = variables['--chat-bubble-assistant-border']?.trim() ?? '';
  const noBaseBubble =
    baseAssistantFill.includes('transparent')
    && (!baseAssistantPadding || baseAssistantPadding === '0')
    && (!baseAssistantBorder || baseAssistantBorder === 'none');
  const managedHasBubbleControl =
    managedBlock.includes(MARKER.bubble)
    || managedBlock.includes(MARKER.assistantVisibility)
    || Boolean(managedUserFill)
    || Boolean(managedAssistantFill)
    || Boolean(managedAssistantPadding);
  const managedUserVisible = Boolean(managedUserFill && !managedUserFill.includes('transparent'));
  const managedAssistantVisible = Boolean(
    managedAssistantFill
    && !managedAssistantFill.includes('transparent')
    && managedAssistantPadding !== '0'
    && managedAssistantBorder !== 'none'
  );

  return {
    background: firstHexColor(readManagedCssValue(managedBlock, '--bg') ?? variables['--bg'], '#ffffff'),
    userBubble: firstHexColor(managedUserFill ?? variables['--chat-bubble-user-fill'] ?? variables['--bubble-user'], '#ededed'),
    assistantBubble: firstHexColor(managedAssistantFill ?? variables['--chat-bubble-assistant-fill'], '#f2f2f4'),
    bubbleOn: managedHasBubbleControl ? managedUserVisible || managedAssistantVisible : !noBaseBubble,
    assistantBubbleOn: managedHasBubbleControl ? managedAssistantVisible : !noBaseBubble,
    backgroundOverride: managedBlock.includes(MARKER.background) || managedBlock.includes('--bg:'),
    userBubbleOverride: managedBlock.includes(MARKER.userBubble) || managedBlock.includes('--chat-bubble-user-fill:'),
    assistantBubbleOverride:
      managedBlock.includes(MARKER.assistantBubble)
      || managedBlock.includes('--chat-bubble-assistant-fill:'),
    assistantBubbleVisibilityOverride:
      managedBlock.includes(MARKER.assistantVisibility)
      || managedBlock.includes('.bubble.assistant { padding: 0;'),
    bubbleOverride:
      managedBlock.includes(MARKER.bubble)
      || managedBlock.includes('--chat-bubble-assistant-padding:')
  };
}

function buildManagedBlock(skin: SkinState) {
  const rootLines: string[] = [];
  const ruleLines: string[] = [];
  const userBubbleVisible = skin.bubbleOn;
  const assistantBubbleVisible = skin.bubbleOn && skin.assistantBubbleOn;
  const userBubbleCustomized = skin.bubbleOverride || skin.userBubbleOverride;
  const assistantBubbleCustomized =
    skin.bubbleOverride
    || skin.assistantBubbleOverride
    || skin.assistantBubbleVisibilityOverride;

  if (skin.backgroundOverride) {
    rootLines.push(
      `  ${MARKER.background}`,
      `  --bg: ${skin.background};`,
      `  --chat-bg: ${skin.background};`,
      `  --cool-bg: ${skin.background};`,
      `  --text: ${readableTextColor(skin.background)};`
    );
  }

  if (skin.bubbleOverride) rootLines.push(`  ${MARKER.bubble}`);
  if (skin.assistantBubbleVisibilityOverride) rootLines.push(`  ${MARKER.assistantVisibility}`);

  if (userBubbleCustomized) {
    if (userBubbleVisible) {
      rootLines.push(
        '  --bubble-user: ' + skin.userBubble + ';',
        '  --chat-bubble-user-fill: ' + skin.userBubble + ';',
        '  --chat-bubble-user-radius: 18px 18px 6px 18px;',
        '  --chat-bubble-user-shadow: var(--shadow-bubble);'
      );
      ruleLines.push(`.bubble.user { color: ${readableTextColor(skin.userBubble)}; }`);
    } else {
      rootLines.push(
        '  --bubble-user: transparent;',
        '  --chat-bubble-user-fill: transparent;',
        '  --chat-bubble-user-radius: 0;',
        '  --chat-bubble-user-shadow: none;'
      );
      ruleLines.push('.bubble.user { padding: 4px; color: var(--text); text-align: right; }');
    }
  }

  if (assistantBubbleCustomized) {
    if (assistantBubbleVisible) {
      rootLines.push(
        '  --chat-bubble-assistant-fill: ' + skin.assistantBubble + ';',
        '  --chat-bubble-assistant-border: 1px solid color-mix(in srgb, var(--border) 58%, transparent);',
        '  --chat-bubble-assistant-padding: 11px 15px;',
        '  --chat-bubble-assistant-shadow: var(--shadow-bubble);',
        '  --chat-bubble-assistant-radius: 18px 18px 18px 6px;'
      );
      ruleLines.push(`.bubble.assistant { color: ${readableTextColor(skin.assistantBubble)}; }`);
    } else {
      rootLines.push(
        '  --chat-bubble-assistant-fill: transparent;',
        '  --chat-bubble-assistant-border: none;',
        '  --chat-bubble-assistant-padding: 0;',
        '  --chat-bubble-assistant-shadow: none;',
        '  --chat-bubble-assistant-radius: 0;'
      );
      ruleLines.push('.bubble.assistant { padding: 0; color: var(--text); }');
    }
  }

  if (rootLines.length === 0 && ruleLines.length === 0) return '';
  const chunks: string[] = [];
  if (rootLines.length > 0) chunks.push([':root {', ...rootLines, '}'].join('\n'));
  if (ruleLines.length > 0) chunks.push(ruleLines.join('\n'));
  return [BLOCK_START, ...chunks, BLOCK_END].join('\n');
}

function setFieldColor(skin: SkinState, field: SkinField, color: string): SkinState {
  return {
    ...skin,
    [field]: color,
    [OVERRIDE_KEY_BY_FIELD[field]]: true
  };
}

function resetFieldColor(skin: SkinState, initial: SkinState, field: SkinField): SkinState {
  return {
    ...skin,
    [field]: initial[field],
    [OVERRIDE_KEY_BY_FIELD[field]]: false
  };
}

export function RoomThemeTuneSection({ theme, onChangeCustomCSS, onSaveCurrentSkin }: RoomThemeTuneSectionProps) {
  const initialRef = useRef<SkinState | null>(null);
  if (!initialRef.current) initialRef.current = resolveInitialSkin(theme);
  const initial = initialRef.current;

  const [skin, setSkin] = useState<SkinState>(initial);
  const skinRef = useRef(skin);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const saveFeedbackTimerRef = useRef<number | null>(null);

  const setPickerState = (next: PickerState | null) => {
    pickerRef.current = next;
    setPicker(next);
  };

  const commitSkin = (next: SkinState) => {
    skinRef.current = next;
    setSkin(next);
    const base = stripManagedBlock(theme.customCSS ?? '');
    const block = buildManagedBlock(next);
    onChangeCustomCSS([base, block].filter(Boolean).join('\n\n'));
  };

  const commitFieldColor = (field: SkinField, color: string) => {
    commitSkin(setFieldColor(skinRef.current, field, color));
  };

  const openPicker = (field: SkinField) => {
    const color = skinRef.current[field] || initial[field];
    const [hue, saturation, value] = hexToHsv(color);
    setPickerState({ field, hue, saturation, value, hex: color });
  };

  const resetField = (field: SkinField) => {
    commitSkin(resetFieldColor(skinRef.current, initial, field));
    setPickerState(null);
  };

  const resetAll = () => {
    commitSkin({
      ...initial,
      backgroundOverride: false,
      userBubbleOverride: false,
      assistantBubbleOverride: false,
      assistantBubbleVisibilityOverride: false,
      bubbleOverride: false
    });
  };

  const updatePickerHsv = (patch: Partial<Pick<PickerState, 'hue' | 'saturation' | 'value'>>) => {
    const current = pickerRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    const hex = hsvToHex(next.hue, next.saturation, next.value);
    setPickerState({ ...next, hex });
    commitFieldColor(current.field, hex);
  };

  const updateSvFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = svRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    updatePickerHsv({
      saturation: clamp((event.clientX - rect.left) / rect.width),
      value: 1 - clamp((event.clientY - rect.top) / rect.height)
    });
  };

  const updateHueFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = hueRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    updatePickerHsv({ hue: clamp((event.clientX - rect.left) / rect.width) * 360 });
  };

  const updateHexInput = (value: string) => {
    const normalized = value.trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return;
    const hex = `#${normalized.toLowerCase()}`;
    const [hue, saturation, pickerValue] = hexToHsv(hex);
    const current = pickerRef.current;
    if (!current) return;
    setPickerState({ ...current, hue, saturation, value: pickerValue, hex });
    commitFieldColor(current.field, hex);
  };

  useEffect(() => () => {
    if (saveFeedbackTimerRef.current != null) window.clearTimeout(saveFeedbackTimerRef.current);
  }, []);

  const hasAnyOverride =
    skin.backgroundOverride
    || skin.userBubbleOverride
    || skin.assistantBubbleOverride
    || skin.assistantBubbleVisibilityOverride
    || skin.bubbleOverride;

  const previewTextColor = readableTextColor(skin.background);
  const assistantBubbleVisible = skin.bubbleOn && skin.assistantBubbleOn;

  const previewBubbleStyle = (visible: boolean, color: string, side: 'user' | 'assistant'): CSSProperties => ({
    background: visible ? color : 'transparent',
    color: visible ? readableTextColor(color) : previewTextColor,
    border: visible && side === 'assistant'
      ? '1px solid color-mix(in srgb, var(--border) 58%, transparent)'
      : 'none',
    padding: visible ? '9px 14px' : '0',
    borderRadius: visible
      ? side === 'user' ? '18px 18px 6px 18px' : '18px 18px 18px 6px'
      : 0
  });

  return (
    <section className="theme-studio-section chat-skin-section">
      <div className="room-theme-preset-head">
        <strong>聊天皮肤</strong>
        <span>颜色、气泡和背景直接点，改完马上能看到</span>
      </div>

      <div
        className="chat-skin-preview"
        style={{ background: skin.background, color: previewTextColor }}
        aria-label="聊天皮肤预览"
      >
        <div className="chat-skin-preview-row is-assistant">
          <span style={previewBubbleStyle(assistantBubbleVisible, skin.assistantBubble, 'assistant')}>
            在吗？
          </span>
        </div>
        <div className="chat-skin-preview-row is-user">
          <span style={previewBubbleStyle(skin.bubbleOn, skin.userBubble, 'user')}>
            在呀，刚忙完。
          </span>
        </div>
      </div>

      <div className="chat-skin-settings">
        <div className="chat-skin-setting-row chat-skin-bubble-toggle-row">
          <strong>使用气泡</strong>
          <label className="chat-skin-switch">
            <input
              type="checkbox"
              checked={skin.bubbleOn}
              onChange={(event) => {
                const checked = event.target.checked;
                commitSkin({
                  ...skinRef.current,
                  bubbleOn: checked,
                  bubbleOverride: true,
                  assistantBubbleOn: checked ? true : skinRef.current.assistantBubbleOn
                });
              }}
            />
            <span />
          </label>
        </div>

        <div className={`chat-skin-setting-row chat-skin-assistant-visibility-row ${skin.bubbleOn ? '' : 'is-disabled'}`.trim()}>
          <strong>对方气泡</strong>
          <label className="chat-skin-switch">
            <input
              type="checkbox"
              checked={skin.assistantBubbleOn}
              disabled={!skin.bubbleOn}
              onChange={(event) => {
                commitSkin({
                  ...skinRef.current,
                  assistantBubbleOn: event.target.checked,
                  assistantBubbleVisibilityOverride: true
                });
              }}
            />
            <span />
          </label>
        </div>

        {FIELD_CONFIG.map((field) => {
          const color = skin[field.id];
          const isCustom = skin[OVERRIDE_KEY_BY_FIELD[field.id]];
          const disabled = field.needBubble && (
            !skin.bubbleOn
            || (field.id === 'assistantBubble' && !skin.assistantBubbleOn)
          );
          return (
            <div
              key={field.id}
              className={`chat-skin-setting-row chat-skin-color-row ${disabled ? 'is-disabled' : ''}`.trim()}
            >
              <div className="chat-skin-color-head">
                <strong>{field.label}</strong>
                <div className="chat-skin-color-controls">
                  <span>{isCustom ? color.toUpperCase() : '默认'}</span>
                  <button
                    type="button"
                    className="chat-skin-color-swatch"
                    style={{ background: color }}
                    aria-label={`调整${field.label}颜色`}
                    aria-expanded={picker?.field === field.id}
                    onClick={() => {
                      if (pickerRef.current?.field === field.id) setPickerState(null);
                      else openPicker(field.id);
                    }}
                  />
                  <button
                    type="button"
                    className="chat-skin-color-reset"
                    disabled={!isCustom}
                    onClick={() => resetField(field.id)}
                  >
                    恢复默认
                  </button>
                </div>
              </div>
              <div className="chat-skin-preset-row">
                {field.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    style={{ background: preset }}
                    aria-label={preset}
                    onClick={() => {
                      commitFieldColor(field.id, preset);
                      openPicker(field.id);
                    }}
                  />
                ))}
              </div>
              {picker?.field === field.id ? (
                <div className="chat-skin-inline-picker">
                  <div
                    ref={svRef}
                    className="chat-skin-picker-sv"
                    style={{
                      background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${picker.hue}, 100%, 50%))`
                    }}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      updateSvFromPointer(event);
                    }}
                    onPointerMove={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSvFromPointer(event);
                    }}
                  >
                    <i
                      style={{
                        left: `${picker.saturation * 100}%`,
                        top: `${(1 - picker.value) * 100}%`,
                        background: picker.hex
                      }}
                    />
                  </div>
                  <div className="chat-skin-picker-hue-row">
                    <div
                      ref={hueRef}
                      className="chat-skin-picker-hue"
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        updateHueFromPointer(event);
                      }}
                      onPointerMove={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHueFromPointer(event);
                      }}
                    >
                      <i style={{ left: `${picker.hue / 360 * 100}%`, background: `hsl(${picker.hue}, 100%, 50%)` }} />
                    </div>
                    <span className="chat-skin-picker-preview" style={{ background: picker.hex }} />
                  </div>
                  <input
                    className="chat-skin-picker-hex"
                    value={picker.hex.toUpperCase()}
                    maxLength={7}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="颜色代码"
                    onChange={(event) => updateHexInput(event.target.value)}
                  />
                  <div className="chat-skin-picker-actions">
                    <button
                      type="button"
                      className="chat-skin-picker-trash"
                      aria-label="恢复默认"
                      onClick={() => resetField(picker.field)}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                      </svg>
                    </button>
                    <button type="button" className="chat-skin-picker-done" onClick={() => setPickerState(null)}>
                      收起
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="chat-skin-actions">
        <button
          type="button"
          className="chat-skin-save"
          onClick={() => {
            onSaveCurrentSkin();
            setSavedFeedback(true);
            if (saveFeedbackTimerRef.current != null) window.clearTimeout(saveFeedbackTimerRef.current);
            saveFeedbackTimerRef.current = window.setTimeout(() => {
              setSavedFeedback(false);
              saveFeedbackTimerRef.current = null;
            }, 1400);
          }}
        >
          {savedFeedback ? '已保存' : '保存'}
        </button>
        <button
          type="button"
          className="chat-skin-reset-all"
          disabled={!hasAnyOverride}
          onClick={resetAll}
        >
          全部恢复默认
        </button>
      </div>
      <p className="chat-skin-note">
        “默认”会跟着浅色 / 深色模式走；改过颜色后，文字会自动选黑或白，保证看得清。
      </p>
    </section>
  );
}


