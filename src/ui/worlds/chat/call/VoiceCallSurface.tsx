import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../../i18n';
import { useChatActions, useChatStablePayload, useChatUi } from '../context/ChatContext';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { useVoiceCallController } from './VoiceCallContext';
import { VoiceCallOverlay } from './VoiceCallOverlay';
import {
  takeAcceptedInvite,
  useDeclineIncomingCall,
  useIncomingCallInvite
} from './useIncomingCallInvite';
import { clearVoiceCallInvite } from '../../../../app/voice/voiceCallInviteStore';
import { VOICE_CALL_MISSED_AUTO_END_MS } from '../../../../engines/voiceCallInvite';

/**
 * Renders the full-screen call surface — either an ongoing call, or one ringing
 * in from the other side.
 *
 * It is portalled to `.app-stage` rather than rendered where it is declared.
 * The chat dock is a ~60px tall positioned ancestor, so an absolutely
 * positioned overlay anchors to it and everything below the orb lands
 * off-screen. The viewport is not an option either: `.world-frame` transitions
 * `transform`/`filter`, and a transformed ancestor captures `position: fixed`
 * too. `.app-stage` is full height, carries no transform of its own, and still
 * sits inside `.app-shell.chat`, so the call screen keeps inheriting the chat
 * theme variables (--surface-deep, --accent, ...).
 */
export function VoiceCallSurface() {
  const call = useVoiceCallController();
  const { conversation } = useChatStablePayload();
  const ui = useChatUi();
  const actions = useChatActions();
  const { t } = useI18n();
  const invite = useIncomingCallInvite(conversation?.id);
  const declineInvite = useDeclineIncomingCall();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const active = call?.active === true;
  /*
   * 来电要等这一轮回复说完再响。
   *
   * 工具是在回复流的中途执行的，如果当场就把整屏来电盖上去，「我打给你」那句话
   * 会被自己的来电界面糊住 —— 用户什么都看不到。等回复收尾再响，读起来才是
   * 「他说完这句话，然后电话响了」。
   */
  const chatBusy = Boolean(ui.sending || ui.streaming);
  const ringing = !active && invite !== null && !chatBusy;

  // actions 每次 render 都可能重建；用 ref 稳定它，避免定时器被引用变化反复重启。
  const notifyCallMissedRef = useRef(actions.notifyCallMissed);
  useEffect(() => {
    notifyCallMissedRef.current = actions.notifyCallMissed;
  }, [actions.notifyCallMissed]);

  useEffect(() => {
    if (!active && !ringing) return;
    setPortalTarget(document.querySelector<HTMLElement>('.app-stage'));
  }, [active, ringing]);

  /*
   * 未接自动挂断：来电响了 30 秒还没人接，就自动收线，并通知 AI「没接」、
   * 唤醒它回应。和「用户点拒接」是同一套结果，只是触发者从点击变成了计时。
   */
  useEffect(() => {
    if (!ringing || !invite) return;
    const timer = window.setTimeout(() => {
      declineInvite(invite);
      void notifyCallMissedRef.current(invite);
    }, VOICE_CALL_MISSED_AUTO_END_MS);
    return () => window.clearTimeout(timer);
  }, [ringing, invite, declineInvite]);

  /*
   * 用户自己拨了电话：那通还在响的来电就该让位，否则挂断之后它会再响一次。
   */
  useEffect(() => {
    if (!active) return;
    if (invite) clearVoiceCallInvite(invite.id);
  }, [active, invite]);

  if (!call || !portalTarget) return null;

  if (active) return createPortal(<VoiceCallOverlay call={call} />, portalTarget);
  if (!ringing || !invite) return null;

  return createPortal(
    <IncomingCallOverlay
      name={invite.collaboratorName.trim() || t('chat.voiceCall.someone')}
      reason={invite.reason}
      onAccept={() => {
        // Take the request out of the store before connecting, so the ringing
        // screen cannot flash back for a frame once the call is live.
        if (!takeAcceptedInvite(invite)) return;
        call.answerIncoming();
      }}
      onDecline={() => {
        declineInvite(invite);
        // 拒绝后立即唤醒 AI：写一条 trigger 消息并触发生成，让它当场回应，不用等下一轮。
        if (invite) void actions.notifyCallDeclined(invite);
      }}
    />,
    portalTarget
  );
}
