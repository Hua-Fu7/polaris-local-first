import { useEffect, useRef } from 'react';
import type { XinchaoDriveSnapshot } from '../../engines/xinchao/runtime';

const DRIVE_ORDER = [
  'possess',
  'monitor',
  'crave',
  'libido',
  'share',
  'social',
  'curiosity',
  'duty',
  'reflection',
  'boredom',
  'grieve',
  'anger'
] as const;

const SHORT_LABELS: Record<(typeof DRIVE_ORDER)[number], string> = {
  possess: '占有',
  monitor: '惦记',
  crave: '渴求',
  libido: '亲密',
  share: '分享',
  social: '陪伴',
  curiosity: '好奇',
  duty: '责任',
  reflection: '反思',
  boredom: '无聊',
  grieve: '难过',
  anger: '生气'
};

const CX = 230;
const CY = 230;
const R0 = 20;
const LMIN = 26;
const LMAX = 150;
const LABEL_R = 200;
const GRAY = [190, 187, 212] as const;
const PINK = [240, 150, 175] as const;

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mixColor(value: number) {
  const t = Math.pow(clamp(value), 0.8);
  const rgb = GRAY.map((channel, index) => Math.round(channel + (PINK[index] - channel) * t));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function petalPath(length: number, width: number) {
  const base = 2 + width * 0.06;
  const y0 = -R0;
  const y1 = -R0 - length;
  return [
    `M${-base},${y0}`,
    `C${-width * 1.25},${y0 - length * 0.45}`,
    `${-width},${y1}`,
    `0,${y1}`,
    `C${width},${y1}`,
    `${width * 1.25},${y0 - length * 0.45}`,
    `${base},${y0}`,
    'Z'
  ].join(' ');
}

type PetalNodes = {
  group: SVGGElement | null;
  path: SVGPathElement | null;
};

export function XinchaoFlower({ drives }: { drives: XinchaoDriveSnapshot[] }) {
  const targets = new Map(drives.map((drive) => [drive.key, clamp(drive.value)]));
  const targetRef = useRef<Record<string, number>>({});
  targetRef.current = Object.fromEntries(DRIVE_ORDER.map((key) => [key, targets.get(key) ?? 0]));
  const currentRef = useRef<Record<string, number>>({ ...targetRef.current });
  const nodeRef = useRef<Partial<Record<(typeof DRIVE_ORDER)[number], PetalNodes>>>({});

  useEffect(() => {
    let frameId = 0;
    const startedAt = performance.now();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (now: number) => {
      const time = (now - startedAt) / 1000;
      DRIVE_ORDER.forEach((key, index) => {
        const current = currentRef.current[key] ?? 0;
        const target = targetRef.current[key] ?? 0;
        const value = current + (target - current) * 0.07;
        currentRef.current[key] = value;

        const angle = index * 360 / DRIVE_ORDER.length;
        const length = LMIN + value * (LMAX - LMIN);
        const width = 7 + value * 13;
        const nodes = nodeRef.current[key];
        nodes?.path?.setAttribute('d', petalPath(length, width));
        nodes?.path?.setAttribute('fill', mixColor(value));
        nodes?.path?.setAttribute('opacity', String(0.7 + value * 0.3));

        const sway = Math.sin(time * 1.4 + index * 0.9) * (0.6 + value * 2.4);
        const breathe = 1 + Math.sin(time * 1.1 + index) * 0.015 * value;
        nodes?.group?.setAttribute(
          'transform',
          `translate(${CX},${CY}) rotate(${angle + (reducedMotion ? 0 : sway)}) scale(${reducedMotion ? 1 : breathe})`
        );
      });
      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
    <svg className="xinchao-flower" viewBox="0 0 460 460" role="img" aria-label="心潮十二维驱动力">
      {DRIVE_ORDER.map((key, index) => {
        const value = targets.get(key) ?? 0;
        const angle = index * 360 / DRIVE_ORDER.length;
        const length = LMIN + value * (LMAX - LMIN);
        const width = 7 + value * 13;
        const radians = (angle - 90) * Math.PI / 180;
        const labelX = CX + Math.cos(radians) * LABEL_R;
        const labelY = CY + Math.sin(radians) * LABEL_R;

        return (
          <g key={key}>
            <g
              ref={(node) => {
                nodeRef.current[key] = { ...(nodeRef.current[key] ?? { path: null }), group: node };
              }}
              transform={`translate(${CX},${CY}) rotate(${angle})`}
            >
              <path
                ref={(node) => {
                  nodeRef.current[key] = { ...(nodeRef.current[key] ?? { group: null }), path: node };
                }}
                d={petalPath(length, width)}
                fill={mixColor(value)}
                opacity={0.7 + value * 0.3}
                className="xinchao-flower-petal"
              />
            </g>
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              className="xinchao-flower-label"
            >
              {SHORT_LABELS[key]}
            </text>
          </g>
        );
      })}
      <circle cx={CX} cy={CY} r={R0 - 2} className="xinchao-flower-core" />
    </svg>
  );
}
