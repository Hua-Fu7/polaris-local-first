import { createContext, useContext, type ReactNode } from 'react';
import type { VoiceCallController } from './useVoiceCall';

/**
 * The call entry lives in the composer attachment sheet while the call screen
 * is rendered by a sibling component, so the world owns the controller once and
 * both ends read it from context instead of threading it through composer props.
 */
const VoiceCallContext = createContext<VoiceCallController | null>(null);

export function VoiceCallProvider({
  value,
  children
}: {
  value: VoiceCallController;
  children: ReactNode;
}) {
  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>;
}

/** Returns null outside a provider, so consumers can still render standalone. */
export function useVoiceCallController(): VoiceCallController | null {
  return useContext(VoiceCallContext);
}
