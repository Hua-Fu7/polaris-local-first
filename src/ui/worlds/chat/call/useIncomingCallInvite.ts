import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  createVoiceCallInvite,
  isVoiceCallInviteExpired,
  type VoiceCallInvite
} from '../../../../engines/voiceCallInvite';
import { useChatStore } from '../../../../stores/chatStore';
import {
  consumeDeliveredVoiceCallTaps,
  registerNativeVoiceCallTapListener
} from '../../../../native/voiceCallNotification';
import {
  clearVoiceCallInvite,
  getVoiceCallInviteServerSnapshot,
  getVoiceCallInviteSnapshot,
  publishVoiceCallInvite,
  subscribeVoiceCallInvite,
  takeVoiceCallInvite
} from '../../../../app/voice/voiceCallInviteStore';
import { createVoiceCallNoteMessage } from '../../../../app/chat/voiceCallEventMessage';
import { useI18n } from '../../../../i18n';

/**
 * Reads the "somebody is calling you" request the `startVoiceCall` tool publishes.
 *
 * Only requests aimed at the conversation on screen are handed back. A call meant
 * for another conversation would otherwise ring here and then feed whatever the
 * user says into the wrong thread — it stays queued instead, and rings when that
 * conversation is opened (the request expires on its own after a minute).
 */
export function useIncomingCallInvite(conversationId: string | null | undefined) {
  const stored = useSyncExternalStore(
    subscribeVoiceCallInvite,
    getVoiceCallInviteSnapshot,
    getVoiceCallInviteServerSnapshot
  );
  // 过期的请求对界面来说等于不存在：没必要为了它渲染一屏没人接的电话。
  const invite = stored && !isVoiceCallInviteExpired(stored) ? stored : null;

  // Tapping the "X wants to talk to you" notification brings the app forward;
  // the tap has to be turned back into a ringing invite for the UI to pick up.
  useEffect(() => {
    let disposed = false;

    const republish = (tap: {
      collaboratorId: string;
      collaboratorName: string;
      conversationId: string;
      reason: string;
      createdAt: number;
    }) => {
      if (disposed) return;
      publishVoiceCallInvite(createVoiceCallInvite({
        collaboratorId: tap.collaboratorId,
        collaboratorName: tap.collaboratorName,
        conversationId: tap.conversationId,
        reason: tap.reason,
        id: `voice-call-tap-${tap.createdAt}`
      }));
    };

    void registerNativeVoiceCallTapListener(republish);
    void consumeDeliveredVoiceCallTaps().then((taps) => {
      for (const tap of taps) republish(tap);
    });

    return () => {
      disposed = true;
    };
  }, []);

  if (!invite) return null;
  if (!conversationId || invite.conversationId !== conversationId) return null;
  return invite;
}

/**
 * 用户点了「接听」：把请求从 store 里取走，交给通话循环。
 *
 * 先取走再接通，是为了让这一屏立刻消失 —— 拨号键另一边还挂着同一个请求的话，
 * 接通瞬间会闪回来一次来电界面。
 */
export function takeAcceptedInvite(invite: VoiceCallInvite) {
  return takeVoiceCallInvite(invite.id);
}

/**
 * 用户点了「拒接」：清掉请求，并在聊天记录里留一条「你没接」。
 *
 * 这条记录是双向的：用户翻记录时看得见，协作者下次回话时也知道自己那通电话
 * 没被接起来。记不上就算了 —— 不值得为一条记录把来电流程炸掉。
 */
export function useDeclineIncomingCall() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  return useCallback((invite: VoiceCallInvite | null) => {
    if (!invite || busy) return;
    setBusy(true);
    clearVoiceCallInvite(invite.id);

    const message = createVoiceCallNoteMessage({
      event: { kind: 'missed' },
      collaboratorName: invite.collaboratorName,
      t
    });
    try {
      const chat = useChatStore.getState();
      const writable = chat.getConversationWritable(invite.conversationId);
      if (writable) chat.addMessage(writable, message);
    } catch {
      // Ignore.
    }
    setBusy(false);
  }, [busy, t]);
}
