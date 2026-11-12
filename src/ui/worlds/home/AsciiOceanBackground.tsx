import { useEffect, useRef } from 'react';
import { OceanEngine, type RenderMode, type SharkSpec } from '../../../engines/asciiOcean';

/**
 * 首页港口里游的那几条大鱼：蝠鲼 + 鲸鲨 + 灰鲨。
 * 体型相差一档，看着才像有远近。
 */
const HOME_SHARKS: SharkSpec[] = [
  { kind: 'manta', size: 1 },
  { kind: 'whaleshark', size: 0.82 },
  { kind: 'classic', size: 0.55 }
];

/** 首页默认的字符风格：盲文点阵 DOTS（细密、通透，白底上像水纹）。 */
const HOME_RENDER_MODE: RenderMode = 'braille';

function parseColor(value: string) {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  const [r, g, b, a = 1] = parts;
  if ([r, g, b].some((channel) => !Number.isFinite(channel))) return null;
  return { r, g, b, a: Number.isFinite(a) ? a : 1 };
}

/**
 * 现在是浅色还是深色。
 *
 * 首页把外壳背景设成 transparent 让海铺满，所以不能只看背景色：
 * 先看应用自己标在 <html data-polaris-appearance> 上的值，再退回系统偏好。
 */
function resolveOceanIsLight() {
  if (typeof window === 'undefined') return true;
  const appearance = document.documentElement.dataset.polarisAppearance;
  if (appearance === 'dark') return false;
  if (appearance === 'light') return true;

  const shell = document.querySelector('.app-shell') ?? document.body;
  const color = parseColor(getComputedStyle(shell).backgroundColor);
  if (color && color.a >= 0.35) {
    const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
    return luminance > 0.55;
  }
  return !window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/**
 * 首页背景的字符海洋。
 *
 * 引擎来自 character-ocean（原作者 stackedlol/ascii-sharks，MIT），
 * 本地只做取舍：首页用 HANZI 风格、三条大鱼、跟着应用深浅色走。
 */
export function AsciiOceanBackground({ portal = false }: { portal?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new OceanEngine(canvas, HOME_SHARKS);
    engine.setRenderMode(HOME_RENDER_MODE);
    // 引擎只画深色海：浅色主题反相成"纸上的墨"，深色主题就保持深色海。
    engine.setTheme(true);
    canvas.dataset.oceanInvert = resolveOceanIsLight() ? 'true' : 'false';
    return () => engine.destroy();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={portal ? 'home-ocean home-ocean--portal' : 'home-ocean'}
      aria-hidden="true"
    />
  );
}
