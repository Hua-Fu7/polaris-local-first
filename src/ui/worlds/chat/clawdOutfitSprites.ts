import { PET_OUTFIT_KEYS } from './clawdOutfits.generated';

/**
 * 装扮是**烘进动画**的：同一个动画有「素体」和「戴帽子」两个版本。
 *
 * 为什么不用叠加层：帽子单独一层只能钉在容器上，螃蟹一动就浮空；
 * 按帧算偏移又跟播放不同步（看起来乱飘）。烘焙后播放时就是一个整体。
 *
 * 例外：少数动画是带动画的 SVG（哈欠、醒来、打瞌睡、撒娇那批），
 * 没法逐帧烘焙，仍然走叠加层。
 */
const available = new Set(PET_OUTFIT_KEYS);

export function hasBakedOutfitSprite(mood: string, accessoryId: string): boolean {
  return available.has(`${mood}--${accessoryId}`);
}

export function resolveOutfitSpritePath(mood: string, accessoryId: string): string | null {
  if (!hasBakedOutfitSprite(mood, accessoryId)) return null;
  return `/pets/clawd/outfits/clawd-${mood}--${accessoryId}.webp`;
}
