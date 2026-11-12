/**
 * Clawd 的装扮（帽子类）。
 *
 * 素材来自上游 clawd-on-desk 的 `assets/accessories/*.svg`（AGPL-3.0，美术版权归原作者）。
 * 这些 SVG 是独立的小图，**不在桌宠的坐标系里**，所以要自己定位置：
 *
 *   - width：占桌宠容器宽度的百分比（螃蟹本体在 302x300 画布里只占 x 100–200）
 *   - top：帽子顶端距容器顶部的百分比
 *
 * 数值是在离线预览页里逐个对出来的（prototypes/pet-outfit-preview.html）。
 */

export type ClawdAccessoryId =
  | 'none'
  | 'cowboy-hat'
  | 'western-cowboy-hat'
  | 'top-hat'
  | 'santa-hat'
  | 'party-hat'
  | 'pumpkin-hat'
  | 'wizard-hat'
  | 'halo'
  | 'cigarette';

export type ClawdAccessory = {
  id: ClawdAccessoryId;
  label: string;
  /** 相对 public/pets/clawd/accessories/ 的文件名；'none' 没有文件。 */
  file?: string;
  width: string;
  top: string;
  /** 水平位置，默认居中（50%）；烟这种要偏到嘴边。 */
  left?: string;
  /** 按底边对齐（帽子和烟都用这个，顶边对齐会浮空）。 */
  bottom?: string;
};

export const CLAWD_ACCESSORIES: readonly ClawdAccessory[] = [
  { id: 'none', label: '不戴', width: '0%', top: '0%' },
  // 帽子按「底边压头顶」对齐（与烘焙脚本同一套规则）：
  // 头顶在画布 208/300 = 69.3%，底边 = 100% - (208 + overlap)/300。
  { id: 'cowboy-hat', label: '牛仔帽', file: 'cowboy-hat.svg', width: '34%', top: '0%', bottom: '28%' },
  { id: 'western-cowboy-hat', label: '西部帽', file: 'western-cowboy-hat.svg', width: '36%', top: '0%', bottom: '28%' },
  { id: 'top-hat', label: '礼帽', file: 'top-hat.svg', width: '26%', top: '0%', bottom: '28%' },
  { id: 'santa-hat', label: '圣诞帽', file: 'santa-hat.svg', width: '34%', top: '0%', bottom: '29.3%' },
  { id: 'party-hat', label: '派对帽', file: 'party-hat.svg', width: '26%', top: '0%', bottom: '29.7%' },
  { id: 'pumpkin-hat', label: '南瓜帽', file: 'pumpkin-hat.svg', width: '30%', top: '0%', bottom: '26%' },
  { id: 'wizard-hat', label: '巫师帽', file: 'wizard-hat.svg', width: '30%', top: '0%', bottom: '29.7%' },
  { id: 'halo', label: '光环', file: 'halo.svg', width: '26%', top: '0%', bottom: '34.7%' },
  { id: 'cigarette', label: '烟', file: 'cigarette.svg', width: '9%', top: '0%', left: '59%', bottom: '20%' }
];

const STORAGE_KEY = 'polaris:clawd:accessory:v1';

export function resolveAccessory(id: ClawdAccessoryId | string | null | undefined): ClawdAccessory {
  return CLAWD_ACCESSORIES.find((item) => item.id === id) ?? CLAWD_ACCESSORIES[0];
}

export function readSelectedClawdAccessory(): ClawdAccessoryId {
  if (typeof window === 'undefined') return 'none';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return CLAWD_ACCESSORIES.some((item) => item.id === raw) ? raw as ClawdAccessoryId : 'none';
  } catch {
    return 'none';
  }
}

export function writeSelectedClawdAccessory(id: ClawdAccessoryId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // best effort
  }
}
