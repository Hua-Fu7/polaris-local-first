import type { CSSProperties } from 'react';

type ChaoticOrbitLoaderProps = {
  size?: number | string;
  color?: string;
  speed?: number | string;
  className?: string;
};

/**
 * Chaotic Orbit loader from LDRS.
 * Adapted from https://github.com/GriffinJohnston/ldrs
 * MIT License, Copyright (c) 2022 Griffin Johnston.
 */
export function ChaoticOrbitLoader({
  size = 36,
  color = 'var(--polaris-loading-orbit-color, var(--app-star-color))',
  speed = 1.5,
  className
}: ChaoticOrbitLoaderProps) {
  const style = {
    '--uib-size': typeof size === 'number' ? `${size}px` : size,
    '--uib-color': color,
    '--uib-speed': typeof speed === 'number' ? `${speed}s` : speed
  } as CSSProperties;

  return (
    <span
      className={['chaotic-orbit-loader', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <span className="chaotic-orbit-loader__inner" />
    </span>
  );
}