import type { ImpactStyle } from '@capacitor/haptics';

type ActionHapticOptions = {
  element?: EventTarget | null;
  settle?: 'visual' | 'none';
  style?: ImpactStyle;
};

/**
 * 触感已移除。保留这些动作包装器，让调用点只负责业务动作，不再触发任何震动。
 */
export function triggerSelectionActionHaptic(_options: ActionHapticOptions = {}) {}

export function triggerImpactActionHaptic(_options: ActionHapticOptions = {}) {}

export function triggerSuccessActionHaptic(_options: ActionHapticOptions = {}) {}

export function runSelectionAction<T>(action: () => T, _options: ActionHapticOptions = {}) {
  return action();
}

export function runImpactAction<T>(action: () => T, _options: ActionHapticOptions = {}) {
  return action();
}

export async function runSuccessAction<T>(action: () => T | Promise<T>, _options: ActionHapticOptions = {}) {
  return action();
}

export async function selectionHaptic() {}

export async function impactHaptic(_style: ImpactStyle = 'light' as ImpactStyle) {}

export async function successHaptic() {}
