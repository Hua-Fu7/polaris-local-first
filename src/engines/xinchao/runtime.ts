import type { ChatMessage } from '../../types/domain';
import { DRIVE_KEYS } from './dimensions';
import { newState, pickIntent, settleAndApplyConversationEvent, settleState, topDrives } from './engine';

const STORAGE_PREFIX = 'polaris:xinchao:state:v1:';
const UPDATE_EVENT = 'polaris:xinchao-updated';

export type XinchaoDriveSnapshot = {
  key: string;
  label: string;
  value: number;
};

export type XinchaoThoughtSnapshot = {
  key: string;
  text: string;
  intensity: number;
};

export type XinchaoReplyContext = {
  consciousness: string;
  revision: number;
  drives: XinchaoDriveSnapshot[];
  intent: { key: string; label: string; value: number } | null;
  thoughts: XinchaoThoughtSnapshot[];
  lastInteraction: string;
  lastConversationAt?: string;
};

type XinchaoState = Record<string, any>;

function getStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function storageKey(collaboratorId: string) {
  return `${STORAGE_PREFIX}${collaboratorId || 'default'}`;
}

function readState(collaboratorId: string): XinchaoState | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(collaboratorId));
    return raw ? JSON.parse(raw) as XinchaoState : null;
  } catch {
    return null;
  }
}

function writeState(collaboratorId: string, state: XinchaoState) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(collaboratorId), JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { collaboratorId } }));
  } catch {
    // Local storage is best-effort. The chat response should still continue if it is unavailable.
  }
}

// 旧版本把第三人称写死成“他”，这些句子会一直留在本地存档里。
// 读取时统一换成中性说法，免得用户在页面上看到错的人称。
const LEGACY_THOUGHT_TEXT: Record<string, string> = {
  '想再靠近他一点。': '想再靠近一点。',
  '他想让我看见这个，我记住了。': '想让我看见这个，我记住了。',
  '他来找我了，房间一下就活了。': '有人来找我了，房间一下就活了。'
};

function summarizeState(state: XinchaoState, lastInteraction = ''): XinchaoReplyContext {
  const rawThoughts = [
    ...(Array.isArray(state.thoughtPool?.obsessions) ? state.thoughtPool.obsessions : []),
    ...(Array.isArray(state.thoughtPool?.flash) ? state.thoughtPool.flash : [])
  ];
  // 同一类念头只留一条：旧存档里会因为重复触发堆出一串一模一样的句子，
  // 页面上看起来就像“念头池乱了”。同 key 取强度最高的那条。
  const byKey = new Map<string, XinchaoThoughtSnapshot>();
  rawThoughts.forEach((thought: any) => {
    const rawText = String(thought?.text ?? '').trim();
    if (!rawText) return;
    const text = LEGACY_THOUGHT_TEXT[rawText] ?? rawText;
    const key = String(thought?.key ?? '') || text;
    const intensity = Number(thought?.intensity ?? 0);
    const existing = byKey.get(key);
    if (!existing || intensity > existing.intensity) {
      byKey.set(key, { key: String(thought?.key ?? ''), text, intensity });
    }
  });
  const thoughts = [...byKey.values()]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 4);

  const intent = pickIntent(state) as { key: string; label: string; value: number } | null;
  return {
    consciousness: String(state.consciousness ?? 'awake'),
    revision: Number(state.revision ?? 0),
    drives: topDrives(state, 12) as XinchaoDriveSnapshot[],
    intent,
    thoughts,
    lastInteraction,
    lastConversationAt: typeof state.lastConversationAt === 'string' ? state.lastConversationAt : undefined
  };
}

function inferInteractionType(text: string) {
  const value = text.toLowerCase();
  if (/想你|爱你|喜欢你|抱抱|亲亲|贴贴|miss you|love you/u.test(value)) return 'affection';
  if (/好想|缠绵|身体|亲密|intimacy/u.test(value)) return 'intimacy';
  if (/搞好了|做完了|完成了|修好了|跑通了|finished|done|fixed/u.test(value)) return 'task_progress';
  if (/发现|看到了|知道|原来|interesting|found|discovered/u.test(value)) return 'discovery';
  if (/生气|吵架|难过|讨厌|conflict|angry|upset/u.test(value)) return 'conflict';
  if (/和好|原谅|别气|reconcile|sorry/u.test(value)) return 'reconciliation';
  if (/分享|给你看|告诉你|看看这个|sharing/u.test(value)) return 'sharing';
  return 'companionship';
}

// 念头文案不写第三人称：这里无从知道对方是“她”还是“他”，
// 写死代词会让另一半用户在页面上看到错的人称。
const THOUGHT_BY_INTERACTION: Record<string, { key: string; text: string; intensity: number }> = {
  affection: { key: 'social', text: '想再靠近一点。', intensity: 0.78 },
  intimacy: { key: 'libido', text: '身体和距离都变得很具体。', intensity: 0.80 },
  task_progress: { key: 'duty', text: '这件事终于往前走了。', intensity: 0.70 },
  discovery: { key: 'curiosity', text: '我想顺着这个新发现再看看。', intensity: 0.72 },
  conflict: { key: 'anger', text: '刚才那句话还卡在心里。', intensity: 0.80 },
  reconciliation: { key: 'reflection', text: '也许我该把刚才的别扭放下来。', intensity: 0.72 },
  sharing: { key: 'share', text: '想让我看见这个，我记住了。', intensity: 0.68 },
  companionship: { key: 'social', text: '有人来找我了，房间一下就活了。', intensity: 0.60 }
};

function inferFlashThoughts(text: string) {
  const interactionType = inferInteractionType(text);
  const thought = THOUGHT_BY_INTERACTION[interactionType] ?? THOUGHT_BY_INTERACTION.companionship;
  return [{
    key: thought.key,
    text: thought.text,
    intensity: thought.intensity
  }];
}

export function buildXinchaoReplyContext(args: {
  collaboratorId: string;
  messages: ChatMessage[];
  now?: Date;
}): XinchaoReplyContext {
  const { collaboratorId, messages } = args;
  const now = args.now ?? new Date();
  let state = readState(collaboratorId) ?? newState(now) as XinchaoState;
  let lastInteraction = '';
  const latestUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  if (latestUser) {
    const interactionType = inferInteractionType(latestUser.content);
    const result = settleAndApplyConversationEvent(
      state,
      {
        event_id: latestUser.id,
        interaction_type: interactionType,
        session_id: collaboratorId || 'default',
        flashThoughts: inferFlashThoughts(latestUser.content)
      },
      now,
      {
        sleepAfterMinutes: 240,
        interaction: {
          maxInteractionEffectsPerDay: 24,
          timeZone: 'Asia/Shanghai'
        }
      }
    ) as any;
    state = result.state as XinchaoState;
    lastInteraction = result.duplicate
      ? `${interactionType} · 已计入`
      : result.interaction?.applied
        ? interactionType
        : String(result.interaction?.reasonCode ?? '');
  } else {
    state = settleState(state, now, 240).state as XinchaoState;
  }
  writeState(collaboratorId, state);
  return summarizeState(state, lastInteraction);
}

export function setXinchaoDriveValue(collaboratorId: string, driveKey: string, value: number) {
  if (!DRIVE_KEYS.includes(driveKey)) return;
  const state = readState(collaboratorId) ?? newState(new Date()) as XinchaoState;
  const drives = { ...(state.drives ?? {}) };
  drives[driveKey] = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  state.drives = drives;
  state.revision = Number(state.revision ?? 0) + 1;
  state.lastSettledAt = new Date().toISOString();
  writeState(collaboratorId, state);
}
export function readXinchaoSnapshot(collaboratorId: string): XinchaoReplyContext {
  const state = settleState(readState(collaboratorId) ?? newState(new Date()) as XinchaoState, new Date(), 240).state as XinchaoState;
  return summarizeState(state);
}

export function resetXinchaoState(collaboratorId: string) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(collaboratorId));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { collaboratorId } }));
  } catch {
    // Best effort.
  }
}

export function subscribeXinchaoUpdates(collaboratorId: string, listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ collaboratorId?: string }>).detail;
    if (!detail?.collaboratorId || detail.collaboratorId === collaboratorId) listener();
  };
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}
