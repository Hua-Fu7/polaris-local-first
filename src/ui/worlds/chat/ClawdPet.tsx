import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStablePayload, useChatUi } from './context/ChatContext';
import { hasBakedOutfitSprite, resolveOutfitSpritePath } from './clawdOutfitSprites';
import {
  CLAWD_ACCESSORIES,
  readSelectedClawdAccessory,
  resolveAccessory,
  writeSelectedClawdAccessory,
  type ClawdAccessoryId
} from './clawdAccessories';

/**
 * 桌宠 Clawd（像素蟹）——聊天界面角落悬浮的会动小宠物。
 *
 * 素材来自 clawd-on-desk（AGPL-3.0 / 美术素材版权归原作者），仅本地展示用。
 * 原始 GIF 是绿幕素材，已离线抠像为透明动画 WebP（public/pets/clawd/*.webp）。
 *
 * 状态模型（重要）：
 *   - baseMood：由实时状态派生（出错 / 思考 / 干活 / 空闲摸鱼），是「背景状态」
 *   - transient：一次性动画（开心 / 提醒 / 被戳），带自己的倒计时，到期自动消失
 *   两者解耦——瞬态动画不会被其它 effect 重跑打断，避免卡住。
 *
 * 动作分组：
 *   - 工作池：干活时随机挑一个，整轮不变
 *   - 摸鱼池：闲置时每 22 秒轮换
 *   - 反应池：戳它一下随机生气 / 二段跳
 */

const PET_ASSET_BASE = '/pets/clawd';

type PetMood =
  | 'idle' | 'thinking' | 'typing' | 'happy' | 'error' | 'notification' | 'sleeping'
  | 'building' | 'carrying' | 'conducting' | 'debugger' | 'juggling' | 'sweeping'
  | 'bubble' | 'idle-reading' | 'headphones-groove' | 'idle-yawn'
  | 'idle-doze' | 'idle-look' | 'aegyo-shy'
  | 'working-ultrathink' | 'working-typing-boss' | 'working-wizard'
  | 'react-annoyed' | 'react-double-jump' | 'react-left' | 'react-right'
  | 'wake';

const MOOD_SRC: Record<PetMood, string> = {
  idle: `${PET_ASSET_BASE}/clawd-idle.webp`,
  thinking: `${PET_ASSET_BASE}/clawd-thinking.webp`,
  typing: `${PET_ASSET_BASE}/clawd-typing.webp`,
  happy: `${PET_ASSET_BASE}/clawd-happy.webp`,
  error: `${PET_ASSET_BASE}/clawd-error.webp`,
  notification: `${PET_ASSET_BASE}/clawd-notification.webp`,
  sleeping: `${PET_ASSET_BASE}/clawd-sleeping.webp`,
  building: `${PET_ASSET_BASE}/clawd-building.webp`,
  carrying: `${PET_ASSET_BASE}/clawd-carrying.webp`,
  conducting: `${PET_ASSET_BASE}/clawd-conducting.webp`,
  debugger: `${PET_ASSET_BASE}/clawd-debugger.webp`,
  juggling: `${PET_ASSET_BASE}/clawd-juggling.webp`,
  sweeping: `${PET_ASSET_BASE}/clawd-sweeping.webp`,
  bubble: `${PET_ASSET_BASE}/clawd-bubble.webp`,
  'idle-reading': `${PET_ASSET_BASE}/clawd-idle-reading.webp`,
  'headphones-groove': `${PET_ASSET_BASE}/clawd-headphones-groove.webp`,
  // 上游是带动画的 SVG（CSS keyframes 或 SMIL），直接当图片用，不用转 webp
  'idle-yawn': `${PET_ASSET_BASE}/clawd-idle-yawn.svg`,
  'idle-doze': `${PET_ASSET_BASE}/clawd-idle-doze.svg`,
  'idle-look': `${PET_ASSET_BASE}/clawd-idle-look.svg`,
  'aegyo-shy': `${PET_ASSET_BASE}/clawd-aegyo-shy.svg`,
  'working-ultrathink': `${PET_ASSET_BASE}/clawd-working-ultrathink.svg`,
  'working-typing-boss': `${PET_ASSET_BASE}/clawd-working-typing-boss.svg`,
  'working-wizard': `${PET_ASSET_BASE}/clawd-working-wizard.svg`,
  'react-left': `${PET_ASSET_BASE}/clawd-react-left.svg`,
  'react-right': `${PET_ASSET_BASE}/clawd-react-right.svg`,
  'wake': `${PET_ASSET_BASE}/clawd-wake.svg`,
  'react-annoyed': `${PET_ASSET_BASE}/clawd-react-annoyed.webp`,
  'react-double-jump': `${PET_ASSET_BASE}/clawd-react-double-jump.webp`
};

/**
 * 素材坑：clawd-mini-*.webp 六个文件右侧带一条不透明 #2b2b2b 黑条，螃蟹也被压扁，
 * 看起来就是「贴边拉长的螃蟹 + 一块黑板」。在重新抠像之前**不要接进池子**。
 */

/** 干活时随机挑一个姿态，长回复里会轮换。 */
const WORK_POOL: readonly PetMood[] = [
  'typing', 'building', 'carrying', 'conducting', 'debugger', 'juggling', 'sweeping',
  'working-ultrathink', 'working-typing-boss', 'working-wizard'
];
/** 闲置时轮换的摸鱼动作。 */
const IDLE_POOL: readonly PetMood[] = [
  'idle', 'bubble', 'idle-reading', 'headphones-groove',
  'idle-doze', 'idle-look', 'aegyo-shy'
];
/** 戳它时的反应。 */
const REACT_POOL: readonly PetMood[] = [
  'react-annoyed', 'react-double-jump', 'react-left', 'react-right'
];

/** 一轮回复结束后，happy 动画停留多久。 */
const HAPPY_HOLD_MS = 1800;
/** 主动消息提醒动画停留多久。 */
const NOTIFICATION_HOLD_MS = 2400;
/** 持续空闲多久后睡着。 */
const SLEEP_AFTER_IDLE_MS = 90_000;
/** 闲置时多久换一个摸鱼动作。 */
const IDLE_SWITCH_MS = 12_000;
/** 回复过程中多久换一个干活姿态（长回复不至于一直同一个动作）。 */
const WORK_SWITCH_MS = 9_000;
/** 戳一下的反应持续多久。 */
const POKE_HOLD_MS = 1500;
/** 打哈欠动画的长度（上游 SVG 固定 3.8 秒）。 */
const YAWN_MS = 3800;
/** 长按多久算「要换装」。 */
const LONG_PRESS_MS = 520;
/**
 * 这些动作的素材里**已经自带帽子/头盔**，再叠一层就重了（比如 building 戴着工地帽）。
 */
const PET_HATLESS_MOODS: ReadonlySet<PetMood> = new Set<PetMood>([
  'building',          // 素材里戴着工地帽
  'headphones-groove'  // 素材里戴着耳机，再扣帽子就叠了
]);

function pick(pool: readonly PetMood[], filter?: (mood: PetMood) => boolean): PetMood {
  const candidates = filter ? pool.filter(filter) : pool;
  const usable = candidates.length ? candidates : pool;
  return usable[Math.floor(Math.random() * usable.length)];
}

export function ClawdPet() {
  const ui = useChatUi();
  const { messages } = useChatStablePayload();

  // 背景状态：空闲摸鱼动作 与 本轮工作姿态
  const [idleMood, setIdleMood] = useState<PetMood>('idle');
  const [workMood, setWorkMood] = useState<PetMood>('typing');
  // 一次性动画（自带倒计时，到期自动消失）
  const [transient, setTransient] = useState<PetMood | null>(null);
  /** 每次换 SVG 动画都 +1，用来让动画从头播（SVG 不会自己重播）。 */
  const [spriteNonce, setSpriteNonce] = useState(0);
  const sleepTimerRef = useRef<number | null>(null);
  /** 当前装扮（帽子）。 */
  const [accessoryId, setAccessoryId] = useState<ClawdAccessoryId>(() => readSelectedClawdAccessory());
  /** 换装弹窗开着没有。 */
  const [outfitOpen, setOutfitOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const transientTimerRef = useRef<number | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);
  const wasBusyRef = useRef(false);
  const busyRef = useRef(false);

  const sending = ui.sending;
  const phase = ui.streaming?.phase ?? null;
  const hasError = ui.commandStatus?.isError === true;
  const busy = hasError || sending || phase === 'stage' || phase === 'live';
  busyRef.current = busy;

  // 最新一条 assistant 消息 id：空闲时突然冒出新消息 = 协作者主动来找你。
  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && !message.toolInvocation) return message.id;
    }
    return null;
  }, [messages]);

  /** 播放一次性动画；重复调用会重置倒计时。 */
  const playTransient = useCallback((mood: PetMood, ms: number) => {
    setSpriteNonce((value) => value + 1);
    setTransient(mood);
    if (transientTimerRef.current !== null) window.clearTimeout(transientTimerRef.current);
    transientTimerRef.current = window.setTimeout(() => {
      transientTimerRef.current = null;
      setTransient(null);
    }, ms);
  }, []);

  // 忙碌开始 → 换一个工作姿态；忙碌结束 → 开心一下。
  // 注意：这里只依赖 busy，不碰任何定时器清理，不会被其它更新打断。
  useEffect(() => {
    const wasBusy = wasBusyRef.current;
    wasBusyRef.current = busy;

    if (busy && !wasBusy) {
      setWorkMood(pick(WORK_POOL, canWearHat));
      lastAssistantIdRef.current = latestAssistantId;
      return;
    }
    if (!busy && wasBusy) {
      lastAssistantIdRef.current = latestAssistantId;
      playTransient('happy', HAPPY_HOLD_MS);
    }
  }, [busy, playTransient, latestAssistantId]);

  // 空闲时冒出新 assistant 消息 → 提醒（首次挂载只记录基线）。
  useEffect(() => {
    if (latestAssistantId === null) return;
    if (latestAssistantId === lastAssistantIdRef.current) return;

    const isFirstSeen = lastAssistantIdRef.current === null;
    lastAssistantIdRef.current = latestAssistantId;
    if (isFirstSeen || busyRef.current) return;

    setIdleMood('idle'); // 有动静就醒
    playTransient('notification', NOTIFICATION_HOLD_MS);
  }, [latestAssistantId, playTransient]);

  // 闲置时轮换摸鱼动作（睡着/忙碌/播放瞬态时不轮换）。
  const idleFrozen = busy || transient !== null || idleMood === 'sleeping';

  useEffect(() => {
    if (idleFrozen) return;
    const timer = window.setInterval(() => {
      setSpriteNonce((value) => value + 1);
      setIdleMood(pick(IDLE_POOL, canWearHat));
    }, IDLE_SWITCH_MS);
    return () => window.clearInterval(timer);
  }, [idleFrozen]);

  // 回复进行中轮换干活姿态：长回复不会从头到尾一个动作。
  // 只在「正在收流」（phase === 'live'）时轮换，思考阶段保持 thinking。
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = window.setInterval(() => {
      setSpriteNonce((value) => value + 1);
      setWorkMood(pick(WORK_POOL, canWearHat));
    }, WORK_SWITCH_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 持续空闲 → 先打个哈欠，再睡着（摸鱼轮换不影响它的计时）。
  useEffect(() => {
    if (busy || transient !== null) return;
    const timer = window.setTimeout(() => {
      // SVG 动画是黑盒，不会自己重播：换一个 nonce 让它重新从头播
      setSpriteNonce((value) => value + 1);
      playTransient('idle-yawn', YAWN_MS);
      sleepTimerRef.current = window.setTimeout(() => {
        sleepTimerRef.current = null;
        setIdleMood('sleeping');
      }, YAWN_MS);
    }, SLEEP_AFTER_IDLE_MS);
    return () => {
      window.clearTimeout(timer);
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
    };
  }, [busy, transient, playTransient]);

  // 戳它一下 → 随机反应；睡着时顺便叫醒。
  const handlePoke = useCallback(() => {
    setIdleMood((current) => {
      if (current !== 'sleeping') return current;
      // 睡着被戳：先播「醒来」，再回到 idle
      playTransient('wake', POKE_HOLD_MS * 2);
      return 'idle';
    });
    playTransient(pick(REACT_POOL, canWearHat), POKE_HOLD_MS);
  }, [playTransient]);

  // 长按 → 打开换装弹窗；短按 → 之前的戳一下。
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePressStart = useCallback(() => {
    longPressFiredRef.current = false;
    cancelLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      setOutfitOpen((open) => !open);
    }, LONG_PRESS_MS);
  }, [cancelLongPress]);

  const handlePressEnd = useCallback(() => {
    const fired = longPressFiredRef.current;
    cancelLongPress();
    if (fired) return;
    handlePoke();
  }, [cancelLongPress, handlePoke]);

  const handleAccessoryPick = useCallback((id: ClawdAccessoryId) => {
    setAccessoryId(id);
    writeSelectedClawdAccessory(id);
    setOutfitOpen(false);
    playTransient('happy', HAPPY_HOLD_MS);
  }, [playTransient]);

  useEffect(() => () => {
    if (transientTimerRef.current !== null) window.clearTimeout(transientTimerRef.current);
    if (sleepTimerRef.current !== null) window.clearTimeout(sleepTimerRef.current);
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
  }, []);

  const baseMood: PetMood = hasError
    ? 'error'
    : phase === 'live'
      ? workMood
      : (phase === 'stage' || sending) ? 'thinking' : idleMood;

  // 忙碌时以工作状态为准（不被残留的瞬态动画盖住）；空闲时才让瞬态动画上浮。
  const shownMood = busy ? baseMood : (transient ?? baseMood);
  const accessory = resolveAccessory(accessoryId);
  // 有烘焙版（螃蟹+帽子一体的整段动画）就用它，没有才退回叠加层
  // 戴帽子时只挑「有烘焙版」的动作，避免出现帽子不跟着走
  const canWearHat = useCallback(
    (mood: PetMood) => !accessory.file || hasBakedOutfitSprite(mood, accessory.id),
    [accessory.file, accessory.id]
  );
  const hatAllowed = accessory.file && !PET_HATLESS_MOODS.has(shownMood);
  const bakedOutfitSrc = hatAllowed ? resolveOutfitSpritePath(shownMood, accessory.id) : null;

  return (
    <div className="clawd-pet">
      <button
        type="button"
        className="clawd-pet__hit"
        aria-label="桌宠（点一下逗它，长按换装）"
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
      />
      {outfitOpen ? (
        <div className="clawd-pet__outfits" role="dialog" aria-label="换装">
          {CLAWD_ACCESSORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`clawd-pet__outfit${item.id === accessoryId ? ' is-active' : ''}`}
              onClick={() => handleAccessoryPick(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <img
        className="clawd-pet__sprite"
        src={bakedOutfitSrc ?? (MOOD_SRC[shownMood].endsWith('.svg')
          ? `${MOOD_SRC[shownMood]}?n=${spriteNonce}`
          : MOOD_SRC[shownMood])}
        alt=""
        draggable={false}
      />
    </div>
  );
}
