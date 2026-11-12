import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { buildCardReference } from '../../../../app/collection/codeCollectionSource';
import { TOOL_DRAFT_BLOCK_PATTERN } from '../../../../app/chat/chatMarkdownPatterns';
import { resolveAssistantStreamingChrome, type ChatMessageLifecycle } from '../../../../app/chat/chatStreamingDisplay';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import type { CodeCardActionMode, CodeCardMessageProgress } from '../../../../app/chat/chatDerivedState';
import type { AvatarDisplaySize, AvatarIconId, AvatarShape, ChatAttachment, ChatCardReference, ChatMessage, ChatMessageVoiceCache, CodeCard } from '../../../../types/domain';
import { PersonaAvatar } from '../../../collaborator/PersonaAvatar';
import { resolveChatAvatarSize } from '../../../collaborator/avatarDisplaySize';
import { Icon } from '../../../Icon';
import { runSelectionAction, runSuccessAction, selectionHaptic } from '../../../haptics';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import type { ChatEditingState } from '../context/ChatUiState';
import { resolveCodeCardActionCopy, resolveMessageRowRoleClass } from '../messageRowMeta';
import { useI18n } from '../../../../i18n';
import { buildMessageCycleAttrs, buildUserBubbleCycleAttrs } from '../userBubbleCycles';
import { MessageActions, type MessageTaskReceiptAction } from './MessageActions';
import { MessageCardReference } from './MessageCardReference';
import { MessageContent } from './MessageContent';
import { ChaoticOrbitLoader } from '../../../shell/ChaoticOrbitLoader';
import { MessageEditInline } from './MessageEditInline';
import { MessageMarkdown } from './MessageMarkdown';
import { MessageMeta } from './MessageMeta';
import { buildThinkingSummary } from '../thinkingSummary';
import { formatMessageClock, splitAssistantReplyIntoBubbles } from './messageBubbleLayout';
import { MessageGeneratedImages } from './MessageGeneratedImages';
import { MessageVoiceBubble } from './MessageVoiceBubble';
import { exportVoiceMessageAudio } from '../../../../app/chat/voiceMessageAudioExport';
import { MessageStickerStrip } from './MessageStickerStrip';
import { MessageToolEvent } from './MessageToolEvent';
import { isProjectedCodeToolName } from './projectedCodeTools';
import { resolveThinkingStatus, resolveThinkingStatusSegmentKey } from './thinkingStatusLine';
import { useThinkingElapsed } from './useThinkingElapsed';
import {
  clearThinkingStartMs,
  readThinkingDurationMs,
  readThinkingStartMs,
  saveThinkingDurationMs,
  saveThinkingStartMs
} from '../../../../app/chat/thinkingDurationStore';
import {
  buildVisibleToolProductCardMessageIds,
  nextToolProductCardActivationBlockedUntil,
  shouldBlockToolProductCardActivation
} from './toolProductCards';

// 「想了多久」只在这个窗口内可信：更早的 timestamp 说明是历史消息，不是这一轮。
const MAX_THINKING_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_THINKING_SECONDS = 60 * 60;

export type MessageLifecycleState = ChatMessageLifecycle;

export type MessageRowState = {
  editing: ChatEditingState;
  isFocused: boolean;
  lifecycle: MessageLifecycleState;
  isThinkingCollapsed: boolean;
  /** 就地展开的思考链是否打开（替代原来的底部卡片）。 */
  isThinkingSummaryOpen: boolean;
  isCodeExpanded: boolean;
  canEdit: boolean;
  canEditAssistant: boolean;
  canRetry: boolean;
  codeCardActionMode: CodeCardActionMode;
  codeCardProgress: CodeCardMessageProgress | null;
  messageCycleIndex: number | null;
};

export type MessageRowActions = {
  removeEditingAttachment: (attachmentId: string) => void;
  updateEditingDraft: (value: string) => void;
  commitEdit: (message: ChatMessage) => Promise<void>;
  cancelEdit: () => void;
  toggleThinkingCollapsed: (messageId: string) => void;
  openThinkingSummary: (message: ChatMessage) => void;
  toggleThinkingSummary: (message: ChatMessage) => void;
  saveImageAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  toggleCodeExpanded: (messageId: string) => void;
  applyCustomCss: (css: string) => void;
  codeCardAction: (message: ChatMessage) => void;
  retry: (message: ChatMessage) => Promise<void>;
  editMessage: (message: ChatMessage) => void;
  deleteMessageTurn: (message: ChatMessage) => void;
  editAssistantMessage: (message: ChatMessage, content: string) => void;
  cacheAssistantSpeech: (message: ChatMessage, voiceCache: ChatMessageVoiceCache) => void;
  forkFromMessage: (message: ChatMessage) => void;
  applyToolPreview: (message: ChatMessage) => void;
  saveToolPreview: (message: ChatMessage) => void;
  rollbackToolPreview: (message: ChatMessage) => void;
  openToolbox: () => void;
  openCodeCard: (cardId: string) => void;
  runCodeCard: (card: CodeCard) => void;
  setCommandStatus: (text: string, isError?: boolean) => void;
};

type MessageRowProps = {
  message: ChatMessage;
  resolvedCardReference?: ChatCardReference | null;
  fallbackAssistantName: string;
  assistantAvatarUrl: string | null;
  assistantAvatarIconId: AvatarIconId | null;
  assistantAvatarShape: AvatarShape;
  assistantAvatarSize: AvatarDisplaySize;
  assistantSigilSeed: string | null;
  showChatAvatars: boolean;
  showCollaboratorName?: boolean;
  showThinking: boolean;
  /** 消息底部的小时钟。缺省开。 */
  showMessageClock?: boolean;
  /** 消息头的模型名胶囊。缺省开。 */
  showModelName?: boolean;
  /** 消息头的 token 用量胶囊。缺省开。 */
  showTokenUsage?: boolean;
  state: MessageRowState;
  actions: MessageRowActions;
  userAvatarUrl: string | null;
  userAvatarIconId: AvatarIconId | null;
  userAvatarShape: AvatarShape;
  userAvatarSize: AvatarDisplaySize;
  toolMessages?: ChatMessage[];
  /** 当前轮按时间顺序合并后的思考 / 工具 / 搜索条目。 */
  thinkingTimelineMessages?: ChatMessage[];
  /** 是否由当前消息渲染整轮唯一的 Thinking 头与时间线。 */
  ownsThinkingTimeline?: boolean;
  /** 当前轮思考是否仍在进行。 */
  isThinkingTimelineActive?: boolean;
  codeCardsById: Record<string, CodeCard>;
  userBubbleIndex?: number;
  isAssistantContinuation?: boolean;
  isTerminalAssistantInUserTurn?: boolean;
  taskReceiptAction?: MessageTaskReceiptAction | null;
};

function MessageRowComponent({
  message,
  resolvedCardReference,
  fallbackAssistantName,
  assistantAvatarUrl,
  assistantAvatarIconId,
  assistantAvatarShape,
  assistantAvatarSize,
  assistantSigilSeed,
  showChatAvatars,
  showCollaboratorName = true,
  showThinking,
  showMessageClock: showMessageClockEnabled = true,
  showModelName = true,
  showTokenUsage = true,
  state,
  actions,
  userAvatarUrl,
  userAvatarIconId,
  userAvatarShape,
  userAvatarSize,
  toolMessages = [],
  thinkingTimelineMessages = [],
  ownsThinkingTimeline = false,
  isThinkingTimelineActive,
  codeCardsById,
  userBubbleIndex,
  isAssistantContinuation = false,
  isTerminalAssistantInUserTurn = true,
  taskReceiptAction = null
}: MessageRowProps) {
  const { t } = useI18n();
  const isToolEvent = Boolean(message.toolInvocation);
  const hideStickerToolReceipt = isToolEvent
    && message.toolInvocation?.kind === 'sendImageAttachment';
  const isAssistantReply = message.role === 'assistant' && !isToolEvent;
  const isUserMessage = message.role === 'user' && !isToolEvent;
  const isPlainSystemMessage = message.role === 'system' && !isToolEvent;
  const sandboxToolInvocation = toolMessages.find((toolMessage) => toolMessage.toolInvocation?.kind === 'runCode')?.toolInvocation ?? null;
  const hasProjectedCodeToolEvent = toolMessages.some((toolMessage) => {
    const tool = toolMessage.toolInvocation;
    return Boolean(tool && isProjectedCodeToolName(tool.kind));
  });
  const isStreamingLike = state.lifecycle === 'streaming-stage' || state.lifecycle === 'streaming-live';
  const thinkingActive = isThinkingTimelineActive ?? isStreamingLike;
  const streamingChrome = resolveAssistantStreamingChrome({
    message,
    lifecycle: state.lifecycle,
    showThinking
  });
  const showStreamingPrelude = streamingChrome.showPrelude;
  const showStreamingHint = streamingChrome.showHint;
  const showStreamingLive = streamingChrome.showLiveHint;
  const showThinkingTimeline = showThinking && ownsThinkingTimeline && thinkingTimelineMessages.length > 0;
  const thinkingTimelineHasSearch = thinkingTimelineMessages.some((timelineMessage) => {
    const kind = timelineMessage.toolInvocation?.kind;
    return kind === 'webSearch' || kind === 'readWebPage' || Boolean(kind?.startsWith('search'));
  });
  const thinkingTimelineHasTool = thinkingTimelineMessages.some((timelineMessage) => Boolean(timelineMessage.toolInvocation));
  const thinkingTimelineActivityIcon = thinkingTimelineHasSearch ? 'search' as const : thinkingTimelineHasTool ? 'tool' as const : null;
  // 正在跑的那个工具决定状态条显示什么；没有在跑就看是在思考还是已经收尾。
  const runningThinkingTool = useMemo(
    () => thinkingTimelineMessages
      .map((timelineMessage) => timelineMessage.toolInvocation)
      .find((tool) => tool?.status === 'running') ?? null,
    [thinkingTimelineMessages]
  );
  const persistedThinkingDurationMs = useMemo(() => readThinkingDurationMs(message.id), [message.id]);
  // 这一轮已经收尾并且存下了秒数：此后不管流式标记怎么抖，都不许再变回「Thinking…」。
  const [settledSeconds, setSettledSeconds] = useState<number | null>(null);
  const thinkingStatus = useMemo(
    () => (settledSeconds !== null
      ? null
      : resolveThinkingStatus({ runningTool: runningThinkingTool, isActive: thinkingActive })),
    [runningThinkingTool, thinkingActive, settledSeconds]
  );
  // 秒数在这一行数：收尾时把总时长存下来，第二天打开还能写成 Thought for 12s。
  const thinkingElapsed = useThinkingElapsed({
    isActive: Boolean(thinkingStatus),
    segmentKey: resolveThinkingStatusSegmentKey(thinkingStatus)
  });
  // 这一轮一开始就把起点落到本机：放后台时这一行可能被卸载重建，
  // 只靠组件里的计时器会从"现在"重新数，收尾就只剩 1s。
  useEffect(() => {
    if (!thinkingStatus) return;
    if (readThinkingStartMs(message.id) !== null) return;
    // 起点取"最早"的那个：占位消息的 timestamp 才是真正开跑的时刻。
    // 切后台回来时组件才挂载，计时器给的"现在"会把时长压成 1s。
    const candidates = [thinkingElapsed.startedAtMs, message.timestamp]
      .filter((value): value is number => typeof value === 'number' && value > 0);
    saveThinkingStartMs(message.id, candidates.length ? Math.min(...candidates) : Date.now());
  }, [message.id, message.timestamp, thinkingElapsed.startedAtMs, thinkingStatus]);

  useEffect(() => {
    if (thinkingStatus) return;
    // 只有"这一行真的见过它在跑"才收尾：
    // 历史消息（没测过、也没存过起点）不能被算成"想了 8 天"。
    const observed = thinkingElapsed.measured || readThinkingStartMs(message.id) !== null;
    if (!observed) return;
    if (persistedThinkingDurationMs !== null || settledSeconds !== null) return;
    // 起点优先用存下来的那一个（跨越了后台/重建），再退回组件里的计时。
    // 起点取最早的那个，但 timestamp 只有在"两小时内"才算数：
    // 历史消息的 timestamp 可能是几天前，拿它减出来的就是这条消息的岁数。
    const now = Date.now();
    const plausible = (value: number | null | undefined): value is number =>
      typeof value === 'number' && value > 0 && now - value < MAX_THINKING_WINDOW_MS;
    const candidates = [readThinkingStartMs(message.id), thinkingElapsed.startedAtMs, message.timestamp]
      .filter(plausible);
    const startedAt = candidates.length ? Math.min(...candidates) : null;
    const seconds = startedAt
      ? Math.min(MAX_THINKING_SECONDS, Math.max(1, Math.round((now - startedAt) / 1000)))
      : Math.max(1, thinkingElapsed.runSeconds);
    saveThinkingDurationMs(message.id, seconds * 1000);
    clearThinkingStartMs(message.id);
    setSettledSeconds(seconds);
  }, [
    message.id,
    persistedThinkingDurationMs,
    settledSeconds,
    thinkingElapsed.measured,
    thinkingElapsed.runSeconds,
    thinkingElapsed.startedAtMs,
    thinkingStatus
  ]);
  // 同一行又开始生成（重试/续写）时，把收尾状态让开。
  useEffect(() => {
    if (isStreamingLike) setSettledSeconds(null);
  }, [isStreamingLike]);
  const shouldShowMeta = showThinking || showChatAvatars;
  const showAssistantMeta =
    shouldShowMeta
    && (!isAssistantContinuation || showThinkingTimeline)
    && !showChatAvatars;
  const showAssistantChatIdentity = showChatAvatars && !isAssistantContinuation;
  const assistantAvatarPx = resolveChatAvatarSize(assistantAvatarSize);
  const userAvatarPx = resolveChatAvatarSize(userAvatarSize);
  const [userActionMenuOpen, setUserActionMenuOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const bubbleFrameRef = useRef<HTMLDivElement>(null);
  const toolProductCardActivationBlockedUntilRef = useRef(0);
  const { label: codeCardActionLabel, progressLabel: codeCardProgressLabel } = resolveCodeCardActionCopy(
    state.codeCardActionMode,
    state.codeCardProgress,
    t
  );
  const resolvedCodeCard = resolvedCardReference ? codeCardsById[resolvedCardReference.id] ?? null : null;
  const visibleToolProductCardMessageIds = useMemo(
    () => buildVisibleToolProductCardMessageIds(toolMessages),
    [toolMessages]
  );
  // 语音条上的「保存」：存的是本机那份 mp3，不会再合成一次、也不花额度。
  const saveVoiceAudio = async (attachment: ChatAttachment) => {
    const result = await exportVoiceMessageAudio({
      assetId: attachment.assetId,
      fallbackName: attachment.name
    });
    actions.setCommandStatus(
      result.ok ? t('chat.voiceMessage.saveAudioDone') : result.error,
      !result.ok
    );
  };

  const currentInteractionTimeMs = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  );
  const markToolReceiptInteraction = () => {
    toolProductCardActivationBlockedUntilRef.current = nextToolProductCardActivationBlockedUntil(
      currentInteractionTimeMs()
    );
  };
  const isToolProductCardActivationBlocked = () => shouldBlockToolProductCardActivation(
    toolProductCardActivationBlockedUntilRef.current,
    currentInteractionTimeMs()
  );
  const runToolProductCardAction = (action: () => void) => {
    if (isToolProductCardActivationBlocked()) return;
    action();
  };
  const renderToolProductCard = (toolMessage: ChatMessage) => {
    // 生成的图片也是成品：大图挂在回执下面，而不是缩在附件 chip 里
    const tool = toolMessage.toolInvocation;
    const imageAttachments = tool && tool.status !== 'failed' && tool.status !== 'running'
      ? (toolMessage.attachments ?? []).filter((attachment) => attachment.kind === 'image')
      : [];
    const generatedImages = imageAttachments.filter((attachment) => !attachment.sticker);
    const stickerAttachments = imageAttachments.filter((attachment) => attachment.sticker);
    const imagesNode = generatedImages.length > 0 ? (
      <MessageGeneratedImages
        attachments={generatedImages}
        onSave={(attachment) => actions.saveImageAttachment(toolMessage, attachment)}
      />
    ) : null;
    const stickersNode = stickerAttachments.length > 0 ? <MessageStickerStrip attachments={stickerAttachments} /> : null;

    const cardNode = (() => {
      if (toolMessages.length > 0 && !visibleToolProductCardMessageIds.has(toolMessage.id)) return null;
      const cardId = tool?.cardId;
      if (!cardId || tool?.status === 'failed') return null;
      const card = codeCardsById[cardId] ?? null;
      if (!card) return null;

      return (
        <MessageCardReference
          reference={buildCardReference(card, 'continue')}
          card={card}
          tone="created"
          onOpen={() => runToolProductCardAction(() => actions.openCodeCard(card.id))}
          onRun={() => runToolProductCardAction(() => actions.runCodeCard(card))}
        />
      );
    })();

    if (!imagesNode && !cardNode && !stickersNode) return null;
    return (
      <>
        {imagesNode}
        {cardNode}
        {stickersNode}
      </>
    );
  };
  const messageStickerAttachments = (message.attachments ?? []).filter((attachment) => attachment.sticker);
  // 语音条：音频附件单独渲染成一条语音，不再走普通附件 chip。
  const messageVoiceAttachment = (message.attachments ?? []).find(
    (attachment) => (attachment.mimeType ?? '').startsWith('audio/')
  );
  const messageAttachmentStrip = (message.attachments ?? []).filter(
    (attachment) => !attachment.sticker && attachment.id !== messageVoiceAttachment?.id
  );
  const stickerOnlyMessage = messageStickerAttachments.length > 0 && !message.content.trim() && messageAttachmentStrip.length === 0;
  // 只保留真能画出东西的工具卡片：MCP 这类没有卡片产物的调用，之前会被包成
  // 一个空的 .tool-product-stack，每调一次就多占一行空白。
  const toolProductCards = toolMessages
    .map((toolMessage) => ({ toolMessage, node: renderToolProductCard(toolMessage) }))
    .filter((entry): entry is { toolMessage: ChatMessage; node: JSX.Element } => entry.node !== null);

  const messageActions = isAssistantReply && !state.editing ? (
    <MessageActions
      canCopyAssistant={message.role === 'assistant' && !message.toolInvocation && !isStreamingLike && isTerminalAssistantInUserTurn && Boolean(message.content.trim())}
      memoryEvidence={message.memoryEvidence ?? null}
      obRecall={message.obRecall ?? null}
      canRetryAssistant={state.canRetry}
      canEditAssistant={state.canEditAssistant}
      canForkAssistant={state.canEditAssistant}
      taskReceiptAction={taskReceiptAction}
      codeCardActionLabel={codeCardActionLabel}
      codeCardActionMode={state.codeCardActionMode}
      codeCardProgressLabel={codeCardProgressLabel}
      messageContent={message.content}
      speechCache={message.voiceCache ?? null}
      role={message.role === 'assistant' ? 'assistant' : 'user'}
      onSetCommandStatus={actions.setCommandStatus}
      onCodeCardAction={() => actions.codeCardAction(message)}
      onRetryLatestAssistant={() => void actions.retry(message)}
      onEditAssistant={(content) => actions.editAssistantMessage(message, content)}
      onForkAssistant={() => actions.forkFromMessage(message)}
    />
  ) : null;
  useEffect(() => {
    if (!userActionMenuOpen) return;

    const handlePointerDownOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleFrameRef.current?.contains(target)) return;
      setUserActionMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [userActionMenuOpen]);

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const openUserActionMenu = () => {
    if (!isUserMessage || state.editing) return;
    void selectionHaptic();
    setUserActionMenuOpen(true);
  };

  const copyUserMessage = async () => {
    if (!message.content.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(message.content));
    setUserActionMenuOpen(false);
  };

  const editUserMessage = () => {
    runSelectionAction(() => {
      setUserActionMenuOpen(false);
      actions.editMessage(message);
    }, { settle: 'none' });
  };

  // 删的是「这一轮」：这条消息加上它引出的全部回答，后面几轮原样留着。
  // 删之前先问一次——这是这里唯一不可撤销的动作。
  const deleteUserMessageTurn = () => {
    if (!window.confirm(t('chat.messageActions.deleteTurnConfirm'))) return;
    runSelectionAction(() => {
      setUserActionMenuOpen(false);
      actions.deleteMessageTurn(message);
    }, { settle: 'none' });
  };

  const handleBubblePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isUserMessage || state.editing) return;
    if (event.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      openUserActionMenu();
    }, 360);
  };

  const handleBubbleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!isUserMessage || state.editing) return;
    event.preventDefault();
    openUserActionMenu();
  };

  // 多气泡：一条助手回复按 markdown 结构拆成几个独立气泡。
  //
  // 流式期间就拆：写完的段落各自成为气泡并定住，只有最后那段还在长。不能等整段
  // 流完再拆 —— 那样先长成一个大气泡、结束时突然裂成好几个，视觉上是"跳"一下。
  //
  // 不拆的几种情况：带附件、卡片引用、原生工具调用、或正文里有工具草稿块
  // （草稿块必须交给 MessageContent 处理，拆开会被当成普通代码块裸奔）。
  const messageBubbleSegments = useMemo(() => {
    if (!isAssistantReply || state.editing) return null;
    if (toolMessages.length > 0) return null;
    if (message.attachments?.length) return null;
    if (resolvedCardReference) return null;
    if (message.nativeToolCalls?.length) return null;
    if (TOOL_DRAFT_BLOCK_PATTERN.test(message.content)) return null;
    return splitAssistantReplyIntoBubbles(message.content);
  }, [
    isAssistantReply,
    state.editing,
    toolMessages.length,
    message.attachments,
    resolvedCardReference,
    message.nativeToolCalls,
    message.content
  ]);
  // 流式期间最后一段还在长，交给 MessageContent（保住平滑出字、行内代码这些流式
  // 处理）；前面已经写完的段落走静态 markdown。
  const liveSegmentMessage = useMemo(() => {
    if (!isStreamingLike || !messageBubbleSegments) return null;
    const tail = messageBubbleSegments[messageBubbleSegments.length - 1];
    if (tail === undefined) return null;
    return { ...message, content: tail };
  }, [isStreamingLike, message, messageBubbleSegments]);
  // 只有思考、没有正文的消息（正文被思考吃光、或本轮确实没吐字）：气泡整个不画，
  // 内容全在折叠行里。留一个空壳在那儿比不画更难看，也更容易让人以为"又坏了"。
  const hideEmptyAssistantBubble =
    isAssistantReply
    && !isStreamingLike
    && !showStreamingPrelude
    && !state.editing
    && !message.content.trim()
    && !message.attachments?.length
    && !resolvedCardReference;
  const showMessageClock =
    showMessageClockEnabled
    && !state.editing
    && !isStreamingLike
    && !showStreamingPrelude
    // 0 / NaN 是「没有时间」的哨兵值，别渲染成 08:00（1970 年那会儿）。
    && Number.isFinite(message.timestamp)
    && message.timestamp > 0;
  const messageBubble = (
    <div
      ref={bubbleFrameRef}
      className={`bubble-frame ${message.role === 'assistant' ? 'assistant' : 'user'} ${state.editing ? 'editing' : ''} ${state.lifecycle} ${showStreamingPrelude ? 'streaming-prelude' : ''} ${userActionMenuOpen ? 'action-menu-open' : ''} ${messageBubbleSegments ? 'multi-bubble' : ''}`}
      onContextMenu={handleBubbleContextMenu}
      onPointerDown={handleBubblePointerDown}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onPointerMove={clearLongPressTimer}
    >
      {state.editing ? (
        <div
          className={`bubble ${message.role === 'assistant' ? 'assistant' : 'user'} editing`}
        >
          <MessageEditInline
            message={message}
            editing={state.editing}
            onRemoveEditingAttachment={actions.removeEditingAttachment}
            onUpdateEditingDraft={actions.updateEditingDraft}
            onCommitEdit={actions.commitEdit}
            onCancelEdit={actions.cancelEdit}
          />
        </div>
      ) : messageBubbleSegments ? (
        messageBubbleSegments.map((segment, index) => {
          const isLiveTail = liveSegmentMessage !== null && index === messageBubbleSegments.length - 1;
          return (
            <div
              key={`${message.id}-bubble-${index}`}
              className="bubble assistant bubble-segment"
              style={{ animationDelay: isStreamingLike ? '0ms' : `${Math.min(index, 6) * 45}ms` }}
            >
              {isLiveTail && liveSegmentMessage ? (
                <>
                  <MessageContent
                    message={liveSegmentMessage}
                    codeCardActionMode={state.codeCardActionMode}
                    isCodeExpanded={state.isCodeExpanded}
                    sandboxToolInvocation={sandboxToolInvocation}
                    hasProjectedCodeToolEvent={hasProjectedCodeToolEvent}
                    hasResolvedToolEvent={toolMessages.length > 0}
                    showThinking={showThinking}
                    preferInlineCode={showStreamingLive}
                    smoothStreamingText={showStreamingLive}
                    onToggleCodeExpanded={() => actions.toggleCodeExpanded(message.id)}
                    onApplyCustomCss={actions.applyCustomCss}
                  />
                  {showStreamingHint ? <div className="assistant-streaming-hint" aria-hidden="true">{t('chat.messageRow.streamingHint')}<span className="assistant-streaming-dots"><span /><span /><span /></span><span className="assistant-streaming-caret" /></div> : null}
                </>
              ) : (
                <MessageMarkdown content={segment} />
              )}
            </div>
          );
        })
      ) : (
        <div
          className={`bubble ${message.role === 'assistant' ? 'assistant' : 'user'} ${state.editing ? 'editing' : ''} ${showStreamingPrelude ? 'streaming-prelude-bubble' : ''}`.trim()}
        >
          <>
            <ChatAttachmentStrip
              attachments={messageAttachmentStrip}
              tone="message"
              onSaveImage={(attachment) => actions.saveImageAttachment(message, attachment)}
            />
            {resolvedCardReference ? (
              <MessageCardReference
                reference={resolvedCardReference}
                card={resolvedCodeCard}
                onOpen={resolvedCodeCard ? () => actions.openCodeCard(resolvedCodeCard.id) : undefined}
                onRun={resolvedCodeCard ? () => actions.runCodeCard(resolvedCodeCard) : undefined}
              />
            ) : null}
            {showStreamingPrelude ? (
              <>
                <div className="assistant-stage-live" aria-label={t('chat.messageRow.generatingAria')}>
                  <ChaoticOrbitLoader size={24} />
                </div>
                {showStreamingHint ? <div className="assistant-streaming-hint" aria-hidden="true">{t('chat.messageRow.streamingHint')}<span className="assistant-streaming-dots"><span /><span /><span /></span><span className="assistant-streaming-caret" /></div> : null}
              </>
            ) : (
              <>
                <MessageContent
                  message={message}
                  codeCardActionMode={state.codeCardActionMode}
                  isCodeExpanded={state.isCodeExpanded}
                  sandboxToolInvocation={sandboxToolInvocation}
                  hasProjectedCodeToolEvent={hasProjectedCodeToolEvent}
                  hasResolvedToolEvent={toolMessages.length > 0}
                  showThinking={showThinking}
                  preferInlineCode={showStreamingLive}
                  smoothStreamingText={showStreamingLive}
                  onToggleCodeExpanded={() => actions.toggleCodeExpanded(message.id)}
                  onApplyCustomCss={actions.applyCustomCss}
                />
                {showStreamingHint ? <div className="assistant-streaming-hint" aria-hidden="true">{t('chat.messageRow.streamingHint')}<span className="assistant-streaming-dots"><span /><span /><span /></span><span className="assistant-streaming-caret" /></div> : null}
              </>
            )}
          </>
        </div>
      )}
      <MessageStickerStrip
        attachments={messageStickerAttachments}
        onLongPress={isUserMessage && !state.editing ? openUserActionMenu : undefined}
      />
      {showMessageClock ? (
        <time className="message-clock" dateTime={new Date(message.timestamp).toISOString()}>
          {formatMessageClock(message.timestamp)}
        </time>
      ) : null}
      {isUserMessage && !state.editing && state.canEdit && userActionMenuOpen ? (
        <div className="user-bubble-action-menu" role="menu" aria-label={t('chat.messageActions.userMenuAria')}>
          <button type="button" className="user-bubble-action-btn" role="menuitem" onClick={() => { void copyUserMessage(); }}>
            <Icon name="copy" size={14} />
            <span>{t('chat.messageActions.copy')}</span>
          </button>
          <button type="button" className="user-bubble-action-btn" role="menuitem" onClick={editUserMessage}>
            <Icon name="edit" size={14} />
            <span>{t('chat.messageActions.editAndRetry')}</span>
          </button>
          <button type="button" className="user-bubble-action-btn danger" role="menuitem" onClick={deleteUserMessageTurn}>
            <Icon name="trash" size={14} />
            <span>{t('chat.messageActions.deleteTurn')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`msg-row ${resolveMessageRowRoleClass(message, isToolEvent)} ${state.isFocused ? 'focused' : ''}`}
      data-message-id={message.id}
      data-row-state={state.lifecycle}
      {...buildUserBubbleCycleAttrs(userBubbleIndex)}
      {...buildMessageCycleAttrs(state.messageCycleIndex)}
    >
      {isToolEvent ? (
        <div className="tool-product-stack">
          {hideStickerToolReceipt ? null : (
            <MessageToolEvent
              message={message}
              onSaveImageAttachment={actions.saveImageAttachment}
              onApplyToolPreview={actions.applyToolPreview}
              onSaveToolPreview={actions.saveToolPreview}
              onRollbackToolPreview={actions.rollbackToolPreview}
              onOpenToolbox={actions.openToolbox}
              onInteractionBoundary={markToolReceiptInteraction}
            />
          )}
          {renderToolProductCard(message)}
        </div>
      ) : isPlainSystemMessage ? (
        <div className="system-inline-note">{message.content}</div>
      ) : isAssistantReply ? (
        <div className={`message-turn assistant ${showChatAvatars ? 'with-avatar' : ''}`}>
          <div className="message-turn-body assistant">
            {showChatAvatars ? (
              <div
                className={`message-avatar-slot assistant ${isAssistantContinuation ? 'empty' : ''}`}
                style={{ width: assistantAvatarPx, minWidth: assistantAvatarPx }}
              >
                {!isAssistantContinuation ? (
                  <PersonaAvatar
                    role="assistant"
                    seed={assistantSigilSeed}
                    imageUrl={assistantAvatarUrl}
                    iconId={assistantAvatarIconId}
                    shape={assistantAvatarShape}
                    size={assistantAvatarPx}
                    className="message-avatar"
                  />
                ) : null}
              </div>
            ) : null}
            <div className="message-turn-stack assistant">
              {showAssistantChatIdentity ? (
                <MessageMeta
                  message={message}
                  fallbackAssistantName={fallbackAssistantName}
                  isThinkingActive={thinkingActive}
                  onOpenThinkingSummary={() => actions.toggleThinkingSummary(message)}
                  isThinkingOpen={state.isThinkingSummaryOpen}
                  hasThinkingActivity={showThinkingTimeline}
                  thinkingActivityIcon={thinkingTimelineActivityIcon}
                  thinkingStatus={thinkingStatus}
                  thinkingElapsed={thinkingElapsed}
                  persistedThinkingDurationSeconds={settledSeconds ?? (persistedThinkingDurationMs === null ? null : Math.round(persistedThinkingDurationMs / 1000))}
                  showName={showCollaboratorName}
                  showModel={showModelName}
                  showTokenUsage={showTokenUsage}
                  showThinking={showThinking}
                />
              ) : null}
              {showAssistantMeta ? (
                <MessageMeta
                  message={message}
                  fallbackAssistantName={fallbackAssistantName}
                  isThinkingActive={thinkingActive}
                  onOpenThinkingSummary={() => actions.toggleThinkingSummary(message)}
                  isThinkingOpen={state.isThinkingSummaryOpen}
                  hasThinkingActivity={showThinkingTimeline}
                  thinkingActivityIcon={thinkingTimelineActivityIcon}
                  thinkingStatus={thinkingStatus}
                  thinkingElapsed={thinkingElapsed}
                  persistedThinkingDurationSeconds={settledSeconds ?? (persistedThinkingDurationMs === null ? null : Math.round(persistedThinkingDurationMs / 1000))}
                  showIdentity={!isAssistantContinuation}
                  showName={showCollaboratorName}
                  showModel={showModelName}
                  showTokenUsage={showTokenUsage}
                  showThinking={showThinking}
                />
              ) : null}
              {showThinkingTimeline && state.isThinkingSummaryOpen ? (
                <div className="message-thinking-inline" aria-label={t('chat.thinking.projectionAria')}>
                  {thinkingTimelineMessages.flatMap((timelineMessage) => {
                    if (timelineMessage.toolInvocation) {
                      if (timelineMessage.toolInvocation.kind === 'sendImageAttachment') return [];
                      return [
                        <MessageToolEvent
                          key={`thinking-tool-${timelineMessage.id}`}
                          message={timelineMessage}
                          onSaveImageAttachment={actions.saveImageAttachment}
                          onApplyToolPreview={actions.applyToolPreview}
                          onSaveToolPreview={actions.saveToolPreview}
                          onRollbackToolPreview={actions.rollbackToolPreview}
                          onOpenToolbox={actions.openToolbox}
                          onInteractionBoundary={markToolReceiptInteraction}
                        />
                      ];
                    }

                    return buildThinkingSummary(timelineMessage.thinkingText ?? '').map((item) => (
                      <p
                        key={`thinking-${timelineMessage.id}-${item.id}`}
                        className={item.kind === 'action' ? 'message-thinking-inline-action' : undefined}
                      >
                        {item.detail}
                      </p>
                    ));
                  })}
                </div>
              ) : null}
              {messageVoiceAttachment ? (
                <MessageVoiceBubble
                  assetId={messageVoiceAttachment.assetId}
                  text={message.content}
                  label="语音"
                  onSaveAudio={() => { void saveVoiceAudio(messageVoiceAttachment); }}
                />
              ) : hideEmptyAssistantBubble ? null : messageBubble}
              {toolProductCards.length > 0 ? (
                <div className="assistant-leading-tool-list">
                  {toolProductCards.map(({ toolMessage, node }) => (
                    <div key={toolMessage.id} className="tool-product-stack">
                      {node}
                    </div>
                  ))}
                </div>
              ) : null}
              {messageActions}
            </div>
          </div>
        </div>
      ) : (
        <div className={`message-turn user ${showChatAvatars ? 'with-avatar' : ''}`}>
          <div className="message-turn-body user">
            <div className="message-turn-stack user">
              {messageBubble}
              {messageActions}
            </div>
            {showChatAvatars ? (
              <div className="message-avatar-slot user">
                <PersonaAvatar
                  role="user"
                  seed={assistantSigilSeed}
                  imageUrl={userAvatarUrl}
                  iconId={userAvatarIconId}
                  shape={userAvatarShape}
                  size={userAvatarPx}
                  className="message-avatar"
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function areMessageRowPropsEqual(previous: MessageRowProps, next: MessageRowProps) {
  return (
    previous.message === next.message
    && previous.fallbackAssistantName === next.fallbackAssistantName
    && previous.assistantAvatarUrl === next.assistantAvatarUrl
    && previous.assistantAvatarIconId === next.assistantAvatarIconId
    && previous.assistantAvatarShape === next.assistantAvatarShape
    && previous.assistantAvatarSize === next.assistantAvatarSize
    && previous.assistantSigilSeed === next.assistantSigilSeed
    && previous.showChatAvatars === next.showChatAvatars
    && previous.showCollaboratorName === next.showCollaboratorName
    && previous.showThinking === next.showThinking
    && previous.userAvatarUrl === next.userAvatarUrl
    && previous.userAvatarIconId === next.userAvatarIconId
    && previous.userAvatarShape === next.userAvatarShape
    && previous.userAvatarSize === next.userAvatarSize
    && previous.toolMessages === next.toolMessages
    && previous.thinkingTimelineMessages === next.thinkingTimelineMessages
    && previous.ownsThinkingTimeline === next.ownsThinkingTimeline
    && previous.isThinkingTimelineActive === next.isThinkingTimelineActive
    && previous.codeCardsById === next.codeCardsById
    && previous.userBubbleIndex === next.userBubbleIndex
    && previous.isAssistantContinuation === next.isAssistantContinuation
    && previous.isTerminalAssistantInUserTurn === next.isTerminalAssistantInUserTurn
    && previous.taskReceiptAction === next.taskReceiptAction
    && previous.message.memoryEvidence === next.message.memoryEvidence
    && previous.state.editing === next.state.editing
    && previous.state.isFocused === next.state.isFocused
    && previous.state.lifecycle === next.state.lifecycle
    && previous.state.isThinkingCollapsed === next.state.isThinkingCollapsed
    && previous.state.isThinkingSummaryOpen === next.state.isThinkingSummaryOpen
    && previous.state.isCodeExpanded === next.state.isCodeExpanded
    && previous.state.canEdit === next.state.canEdit
    && previous.state.canEditAssistant === next.state.canEditAssistant
    && previous.state.canRetry === next.state.canRetry
    && previous.state.codeCardActionMode === next.state.codeCardActionMode
    && previous.state.codeCardProgress === next.state.codeCardProgress
    && previous.state.messageCycleIndex === next.state.messageCycleIndex
  );
}

export const MessageRow = memo(MessageRowComponent, areMessageRowPropsEqual);





