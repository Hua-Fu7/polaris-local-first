/**
 * 心潮状态要不要塞进这一轮的请求。
 *
 * 心潮每轮都会结算，但状态没变就往 prompt 里再贴一遍，会让小机每轮都
 * "被提醒一次自己的状态"，回回都要念这件事。所以：
 *   - 状态版本（revision）没变 → 不贴；
 *   - 但有驱力过了"涌"线（≥ 0.6）且这一轮没贴过 → 贴一次；
 *   - 换了对话 → 贴一次（新对话需要初始印象）。
 */

const STORAGE_KEY = 'polaris:xinchao:injected:v1';
const ENABLED_KEY = 'polaris:xinchao:inject-enabled:v1';
const SURGE_THRESHOLD = 0.6;

/**
 * 心潮要不要贴进请求，用户可以整个关掉。
 * 默认开；关掉后 {@link shouldInjectXinchaoContext} 一律返回 false，也不记录状态。
 */
export function isXinchaoInjectionEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setXinchaoInjectionEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // best effort
  }
}

type InjectedRecord = {
  revision: number;
  surgeKey: string;
};

function readAll(): Record<string, InjectedRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(value: Record<string, InjectedRecord>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best effort
  }
}

function surgeKeyOf(snapshot: { drives: { key: string; value: number }[] }) {
  return snapshot.drives
    .filter((drive) => drive.value >= SURGE_THRESHOLD)
    .map((drive) => drive.key)
    .sort()
    .join(',');
}

export function shouldInjectXinchaoContext(args: {
  collaboratorId: string;
  conversationId: string;
  snapshot: { revision: number; drives: { key: string; value: number }[] } | null;
}): boolean {
  const { collaboratorId, conversationId, snapshot } = args;
  if (!snapshot) return false;
  if (!isXinchaoInjectionEnabled()) return false;

  const scopeKey = `${collaboratorId || 'default'}::${conversationId || 'default'}`;
  const store = readAll();
  const previous = store[scopeKey];
  const surgeKey = surgeKeyOf(snapshot);

  const changed = !previous || previous.revision !== snapshot.revision;
  const surged = Boolean(surgeKey) && surgeKey !== (previous?.surgeKey ?? '');

  if (!changed && !surged) return false;

  store[scopeKey] = { revision: snapshot.revision, surgeKey };
  writeAll(store);
  return true;
}
