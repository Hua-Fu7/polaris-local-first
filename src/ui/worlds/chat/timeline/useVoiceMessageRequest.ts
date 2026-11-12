import { useEffect, useState } from 'react';
import {
  readVoiceMessageRequest,
  subscribeVoiceMessageRequests,
  type VoiceMessageRequest
} from '../../../../app/chat/voiceMessageRequestStore';

/**
 * 读当前会话那条「想发语音」的申请。
 *
 * 申请是工具调用那一轮才写进内存的，所以不能只在渲染时读一次：挂载时先同步一遍，
 * 之后跟着 store 的订阅走。换会话时直接按会话 id 过滤，免得把上一个会话的申请
 * 闪到新会话里。
 */
export function useVoiceMessageRequest(conversationId: string | null): VoiceMessageRequest | null {
  const [request, setRequest] = useState<VoiceMessageRequest | null>(
    () => (conversationId ? readVoiceMessageRequest(conversationId) : null)
  );

  useEffect(() => {
    if (!conversationId) {
      setRequest(null);
      return;
    }
    const sync = () => setRequest(readVoiceMessageRequest(conversationId));
    sync();
    return subscribeVoiceMessageRequests(sync);
  }, [conversationId]);

  if (!conversationId || request?.conversationId !== conversationId) return null;
  return request;
}
