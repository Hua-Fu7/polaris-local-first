import { useRef } from 'react';
import { COLLECTION_FRONTSTAGE_SURFACES } from '../frontstage/frontstageSurfaceRegistry';

const SECRET_LONG_PRESS_MS = 1_200;

type WorldAnchorProps = {
  switchLabel: string;
  onToggleWorld: (trigger: HTMLElement | null) => void;
  onSecretLongPress: () => void;
};

/**
 * Invisible topbar interaction surface.
 *
 * The product now keeps the main-page topbar visually empty. This button keeps
 * the legacy world toggle and long-press sandbox entry reachable without
 * rendering the former collaborator title, metadata, or star mark.
 */
export function WorldAnchor({
  switchLabel,
  onToggleWorld,
  onSecretLongPress
}: WorldAnchorProps) {
  const pressTimerRef = useRef<number | null>(null);
  const secretTriggeredRef = useRef(false);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    secretTriggeredRef.current = false;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      secretTriggeredRef.current = true;
      pressTimerRef.current = null;
      onSecretLongPress();
    }, SECRET_LONG_PRESS_MS);
  };

  const handlePointerEnd = () => {
    clearPressTimer();
  };

  const handleClick = (trigger: HTMLElement | null) => {
    if (secretTriggeredRef.current) {
      secretTriggeredRef.current = false;
      return;
    }
    onToggleWorld(trigger);
  };

  return (
    <button
      className="brand-trigger world-anchor world-anchor--bare"
      data-surface={COLLECTION_FRONTSTAGE_SURFACES.worldAnchor}
      onClick={(event) => handleClick(event.currentTarget)}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      aria-label={switchLabel}
    />
  );
}