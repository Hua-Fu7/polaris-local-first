import type { AssistantToolContext } from '../assistantToolProtocol';
import type { OpenAiToolHistoryMode } from '../provider-runtime/providerRuntimeOpenAiToolHistory';
import type { ProviderHttpRequest } from '../provider-runtime';
import type { AssistantRequestAudit } from './requestAudit';
import type { ObRecallResult } from '../ombreBrain/obRecall';
import { recordRequestDebug } from './requestDebugRecorder';
import {
  prepareCollaboratorReplyRequest,
  messageContainsUnreadableImage,
  resolveRequestImageHydrationMessageIds,
  type RequestImageUnderstandingResult
} from './requestPreparation';
import type { RequestMessage } from './requestMessage';
import { applyRegexRules } from '../regexProcessor';
import { providerRuntimeSupportsImageInput } from '../provider-runtime';
import {
  requestAssistantReply,
  type AssistantReply,
  type AssistantReplyProgress
} from '../chatApi';
import { promoteInlineThinkingTags } from '../inlineThinkingTags';
import type {
  ChatMessage,
  Conversation,
  ConversationTaskState,
  ImageUnderstandingSettings,
  MemoryVectorRetrievalSettings,
  ObBrainSettings,
  Persona,
  ProviderProfile,
  ToolLedgerEntry
} from '../../types/domain';

function normalizeAssistantOutput<T extends AssistantReply | AssistantReplyProgress>(
  reply: T,
  persona: Persona | null | undefined,
  options: { streamingInlineThinking?: boolean } = {}
): T {
  const promoted = promoteInlineThinkingTags(reply, {
    streaming: options.streamingInlineThinking === true
  });
  return {
    ...promoted,
    content: applyRegexRules(promoted.content, persona?.advanced.regexRules, 'output'),
    thinkingText: promoted.thinkingText
      ? applyRegexRules(promoted.thinkingText, persona?.advanced.regexRules, 'output')
      : promoted.thinkingText
  };
}

function messageContainsImageMissingModelPayload(message: Pick<RequestMessage, 'attachments'> | undefined): boolean {
  return Boolean(message?.attachments?.some((attachment) =>
    attachment.kind === 'image'
    && !attachment.clearedAt
    && typeof attachment.dataUrl !== 'string'
  ));
}

export async function requestCollaboratorReply(params: {
  api: ProviderProfile;
  providers?: ProviderProfile[];
  globalApi?: ProviderProfile;
  memoryVectorRetrieval?: MemoryVectorRetrievalSettings;
  obBrain?: ObBrainSettings;
  loadObPassword?: () => Promise<string>;
  imageUnderstanding?: ImageUnderstandingSettings;
  persona: Persona | null | undefined;
  personas?: Persona[];
  messages: ChatMessage[];
  semanticRecallEnabled?: boolean;
  semanticRecallConversations?: Conversation[];
  loadSemanticRecallConversations?: (conversationIds: string[]) => Promise<Conversation[]>;
  activeConversationId?: string | null;
  toolLedger?: ToolLedgerEntry[];
  toolContext?: AssistantToolContext;
  currentTask?: ConversationTaskState | null;
  preferredOpenAiToolHistoryMode?: OpenAiToolHistoryMode;
  nickname?: string;
  signal?: AbortSignal;
  onProgress?: (reply: AssistantReplyProgress) => void;
  onAudit?: (audit: AssistantRequestAudit) => void;
  onImageUnderstandingResults?: (results: RequestImageUnderstandingResult[]) => void;
  /** 这一轮 OB 召回的落地结果；界面拿它显示“召回 N 条 / 没连上”。 */
  onObRecall?: (recall: ObRecallResult) => void;
}): Promise<AssistantReply> {
  const {
    api,
    providers,
    globalApi,
    memoryVectorRetrieval,
    obBrain,
    loadObPassword,
    imageUnderstanding,
    persona,
    personas,
    messages,
    semanticRecallEnabled,
    semanticRecallConversations,
    loadSemanticRecallConversations,
    activeConversationId,
    toolLedger,
    toolContext,
    currentTask,
    preferredOpenAiToolHistoryMode,
    nickname,
    signal,
    onProgress,
    onAudit,
    onImageUnderstandingResults,
    onObRecall
  } = params;
  const prepared = await prepareCollaboratorReplyRequest({
    api,
    providers,
    globalApi,
    memoryVectorRetrieval,
    obBrain,
    loadObPassword,
    imageUnderstanding,
    persona,
    personas,
    messages,
    semanticRecallEnabled,
    semanticRecallConversations,
    loadSemanticRecallConversations,
    activeConversationId,
    toolLedger,
    toolContext,
    currentTask,
    nickname,
    signal
  });
  onAudit?.(prepared.audit);
  if (prepared.obRecall) onObRecall?.(prepared.obRecall);
  if (prepared.imageUnderstandingResults.length > 0) {
    onImageUnderstandingResults?.(prepared.imageUnderstandingResults);
  }
  const supportsImageInput = providerRuntimeSupportsImageInput(api, persona?.advanced);
  const conversation = prepared.conversation;
  const requestImageMessageIds = resolveRequestImageHydrationMessageIds(conversation);
  const requestImageMessages = conversation.filter((message) => requestImageMessageIds.has(message.id));
  if (supportsImageInput && requestImageMessages.some(messageContainsImageMissingModelPayload)) {
    throw new Error('图片附件没有成功进入模型请求；这轮不会只把文件名发给模型硬猜。请重试发送图片，或检查本地附件存储。');
  }
  if (!supportsImageInput && requestImageMessages.some(messageContainsUnreadableImage)) {
    throw new Error('当前模型没有直接图片能力，也没有可用的看图/OCR 模型；请切换支持图片的聊天模型，或在设置里配置看图/OCR 路线后再发送。');
  }

  recordRequestDebug(prepared.audit, { phase: 'prepared' });

  let reply: AssistantReply;
  let builtRequestForDebug: ProviderHttpRequest | null = null;
  try {
    reply = await requestAssistantReply({
      api,
      context: prepared.context,
      sessionId: activeConversationId ?? undefined,
      advanced: prepared.advanced,
      preferredOpenAiToolHistoryMode,
      onBuiltRequest: (request) => {
        builtRequestForDebug = request;
      },
      signal,
      onProgress: onProgress
        ? (partialReply) => onProgress(normalizeAssistantOutput(partialReply, persona, { streamingInlineThinking: true }))
        : undefined
    });
  } catch (error) {
    recordRequestDebug(prepared.audit, { phase: 'failed', error, builtRequest: builtRequestForDebug });
    throw error;
  }

  recordRequestDebug(prepared.audit, {
    phase: 'completed',
    reply,
    builtRequest: builtRequestForDebug
  });

  return normalizeAssistantOutput(reply, persona);
}
