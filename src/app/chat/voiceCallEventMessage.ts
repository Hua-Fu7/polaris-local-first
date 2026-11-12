import { createMessage } from '../../engines/chatMessageFactory';
import type { I18nTranslator } from '../../i18n';
import type { ChatMessage } from '../../types/domain';

/**
 * 通话结束后落进聊天记录的那一条。
 *
 * 为什么需要它：接听与否是判断层的产物，那一层本身不写聊天记录，判断失败时更不会
 * 生成任何回复；什么也不留的话，用户回到聊天里就看不出这通电话发生过。
 *
 * 为什么用 `system-note` 而不是 `trigger-runtime`：后者在时间线里是被**跳过**的
 * （见 `messageTimelineItems`），它只喂给模型、不给用户看。这里恰好相反：记录要
 * 看得见，同时模型也该知道刚通了一通电话，所以两个面都要给。
 */

export type VoiceCallNoteEvent =
  /** 对方看了这通电话，选择不接。 */
  | { kind: 'declined'; declineLine: string | null }
  /** 这次是对方打过来的，用户没接。 */
  | { kind: 'missed' }
  /** 接通过，通话以这个时长结束。 */
  | { kind: 'connected'; durationMs: number };
/**
 * 时长按打电话的习惯写成 `m:ss`，不跟着语言走 —— 「2:13」在哪种语言里都是这个意思，
 * 而且不会像「2 分 13 秒」那样在时间线上占掉一整行。
 */
export function formatVoiceCallDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function createVoiceCallNoteMessage(args: {
  event: VoiceCallNoteEvent;
  collaboratorName: string;
  t: I18nTranslator['t'];
}): ChatMessage {
  const { event, t } = args;
  const name = args.collaboratorName.trim() || t('chat.voiceCall.someone');

  let timeline: string;
  let request: string;

  if (event.kind === 'declined') {
    // 对方留了话就一并记上：屏幕上那句会随浮层一起消失，聊天记录是它唯一的落点。
    const line = event.declineLine?.trim() ?? '';
    timeline = line
      ? t('chat.voiceCall.noteDeclinedLine', { name, line })
      : t('chat.voiceCall.noteDeclined', { name });
    request = line
      ? t('chat.voiceCall.noteDeclinedRequestLine', { name, line })
      : t('chat.voiceCall.noteDeclinedRequest', { name });
  } else if (event.kind === 'missed') {
    // 方向反过来：电话是对方打的，没接的是用户。这条记录存在的意义是让对方
    // 之后知道「我那通电话他没接」，而不是让用户以为自己错过了什么。
    timeline = t('chat.voiceCall.noteMissed', { name });
    request = t('chat.voiceCall.noteMissedRequest', { name });
  } else {
    const duration = formatVoiceCallDuration(event.durationMs);
    timeline = t('chat.voiceCall.noteConnected', { name, duration });
    request = t('chat.voiceCall.noteConnectedRequest', { duration });
  }

  /*
   * `requestRole` 故意留空：这条记录只是给模型的事实，不该被当成一轮用户输入、
   * 更不该顺手触发一次回复（那是 `trigger-runtime` 的做法，方向相反）。
   *
   * `requestDelivery: 'always'` 必须带着：DeepSeek 一类会为前缀缓存把"易变
   * system 层"整组丢掉（见 requestShared/messages.ts），通话记录正是最不能丢的
   * 那一类——丢了模型就永远不知道这通电话发生过。
   */
  return {
    ...createMessage('system', timeline, undefined, 'system-note'),
    requestContent: request,
    requestDelivery: 'always'
  };
}

/**
 * 通话「接通」的那一刻落进聊天记录的一条。
 *
 * 它和 `createVoiceCallNoteMessage` 的 `connected` 是同一通电话的头尾两个事件：
 * 这条在接通时写（让模型在通话中的每一轮都能看到「我正在和用户通话」），
 * `connected` 那条在挂断时写（让模型知道这通电话已经结束、时长多少）。
 *
 * 之所以单独一条而不是复用 `connected`：`connected` 带的是「时长」语义，
 * 通话没结束就写它会写成「通话了 0:00」，既不对，也让模型以为电话已经挂了。
 */
export function createVoiceCallConnectedNoteMessage(args: {
  collaboratorName: string;
  /**
   * 用户拨入、AI 判断接听时的判断理由。有值说明这是「拨入」方向——模型据此知道
   * 是用户打过来的、自己刚才判断了要接；没值则是「拨出」方向（用户接了 AI 的来电）。
   */
  acceptedReason?: string;
  t: I18nTranslator['t'];
}): ChatMessage {
  const name = args.collaboratorName.trim() || args.t('chat.voiceCall.someone');
  const reason = args.acceptedReason?.trim();
  return {
    ...createMessage('system', args.t('chat.voiceCall.noteConnectedStart', { name }), undefined, 'system-note'),
    requestContent: reason
      ? args.t('chat.voiceCall.noteConnectedStartInboundRequest', { reason })
      : args.t('chat.voiceCall.noteConnectedStartRequest'),
    // 通话中的每一轮都靠这条知道自己"正在通话"，任何 provider 都不允许省略。
    requestDelivery: 'always'
  };
}

/**
 * 用户拒接协作者的来电后，用来「唤醒」协作者、让它这一轮就回应的一条。
 *
 * 它和 `createVoiceCallNoteMessage` 的 `missed` 是同一件事的两半：
 * `missed` 那条写进时间线、留给用户看，但 `requestRole` 留空、不触发回复；
 * 这一条走 `trigger-runtime`，时间线里被跳过，只以 `requestRole: 'user'` 的身份
 * 喂给模型，把「被拒接」这件事作为一轮输入推给它 —— 于是它不用等用户下一条
 * 消息，当场就能回应。
 */
export function createVoiceCallDeclinedWakeMessage(args: {
  t: I18nTranslator['t'];
}): ChatMessage {
  return {
    ...createMessage('system', '（系统：来电被拒接）', undefined, 'trigger-runtime'),
    requestRole: 'user',
    requestContent: args.t('chat.voiceCall.wakeDeclinedRequest')
  };
}

/**
 * 用户一直没接、响铃超时自动挂断后，唤醒协作者的那条。
 *
 * 和 `declined` 那条的区别只在语义：一个是用户主动点了拒接，一个是没人理、
 * 超时自动挂了。对模型来说都是「这通电话没接通」，但措辞分开写更诚实。
 */
export function createVoiceCallMissedWakeMessage(args: {
  t: I18nTranslator['t'];
}): ChatMessage {
  return {
    ...createMessage('system', '（系统：来电未接，已自动挂断）', undefined, 'trigger-runtime'),
    requestRole: 'user',
    requestContent: args.t('chat.voiceCall.wakeMissedRequest')
  };
}

/**
 * 通话正常结束（挂断）后，唤醒协作者、让它主动发一句收尾的那条。
 *
 * 挂断是双向都可能主动发起的（用户点「结束通话」，或 AI 用 hangUp 工具）。
 * 不管哪边先挂，只要这通电话是接通过的，就推这一条让 AI 自然收个尾。
 */
export function createVoiceCallEndedWakeMessage(args: {
  t: I18nTranslator['t'];
}): ChatMessage {
  return {
    ...createMessage('system', '（系统：通话已结束）', undefined, 'trigger-runtime'),
    requestRole: 'user',
    requestContent: args.t('chat.voiceCall.wakeEndedRequest')
  };
}
