/**
 * 每条回答「想了多久」的本地记录。
 *
 * 只用来在 Thinking 那行显示 `Thought for 12s`。聊天消息的 SQLite 落库是固定列，
 * 为这一条显示信息不值得动消息表，所以单独放在 localStorage 里，键是 message id。
 */

const STORAGE_KEY = 'polaris-thinking-durations-v1';
/** 这一轮什么时候开始的（墙上时间）。放后台时组件可能被卸载，
 *  只靠组件里的计时器会丢掉起点，收尾时就成了 1s。 */
const START_KEY = 'polaris-thinking-starts-v1';
const MAX_ENTRIES = 300;
/** 一轮最多记一小时；更大的值是旧版本算错的（拿消息岁数当思考时长），读的时候丢掉。 */
const MAX_PLAUSIBLE_MS = 60 * 60 * 1000;

type DurationMap = Record<string, number>;

let cached: DurationMap | null = null;

function resolveStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): DurationMap {
  if (cached) return cached;
  const store = resolveStorage();
  if (!store) {
    cached = {};
    return cached;
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, number] => (
            typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
          )
        )
      : [];
    cached = Object.fromEntries(entries);
  } catch {
    cached = {};
  }
  return cached ?? {};
}

type StartMap = Record<string, number>;

function loadStarts(): StartMap {
  const store = resolveStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(START_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
      )
    );
  } catch {
    return {};
  }
}

/** 记下这一轮开始的时间；已经有了就不要再改（组件重挂载不重置起点）。 */
export function saveThinkingStartMs(messageId: string, startedAtMs: number): void {
  if (!messageId) return;
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return;
  const store = resolveStorage();
  if (!store) return;
  const starts = loadStarts();
  // 已经有起点了就别覆盖：组件重挂载 / 二次渲染都会再调一次。
  if (typeof starts[messageId] === 'number') return;
  const next = { ...starts, [messageId]: Math.round(startedAtMs) };
  const entries = Object.entries(next).sort((left, right) => left[1] - right[1]);
  const trimmed = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : next;
  try {
    store.setItem(START_KEY, JSON.stringify(trimmed));
  } catch {
    // 存不下就算了。
  }
}

export function readThinkingStartMs(messageId: string): number | null {
  if (!messageId) return null;
  const value = loadStarts()[messageId];
  return typeof value === 'number' && value > 0 ? value : null;
}

/** 收尾算完就把起点删掉，免得存档越来越长。 */
export function clearThinkingStartMs(messageId: string): void {
  if (!messageId) return;
  const store = resolveStorage();
  if (!store) return;
  const starts = loadStarts();
  if (!(messageId in starts)) return;
  delete starts[messageId];
  try {
    store.setItem(START_KEY, JSON.stringify(starts));
  } catch {
    // 存不下就算了。
  }
}

export function readThinkingDurationMs(messageId: string): number | null {
  if (!messageId) return null;
  const value = load()[messageId];
  if (typeof value !== 'number' || value <= 0) return null;
  // 旧版本把「消息有多老」当成「想了多久」存进来过，超过一小时的一律不认。
  return value > MAX_PLAUSIBLE_MS ? null : value;
}

export function saveThinkingDurationMs(messageId: string, durationMs: number): void {
  if (!messageId) return;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;

  const rounded = Math.round(durationMs);
  if (load()[messageId] === rounded) return;

  const next: DurationMap = { ...load(), [messageId]: rounded };
  const entries = Object.entries(next);
  cached = entries.length > MAX_ENTRIES
    ? Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
    : next;

  try {
    resolveStorage()?.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // 存不下就算了：下次打开只是少一个秒数，不影响聊天。
  }
}
