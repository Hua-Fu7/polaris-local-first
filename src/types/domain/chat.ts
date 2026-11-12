import type { ChatNativeToolCall } from './primitives';
import type { ChatCardReference } from './collection';
import type { ToolInvocation, ToolLedgerEntry } from './tools';
import type { VoiceGenerationFormat, VoiceGenerationProviderType } from './persona';

export type ChatMessageVoiceCache = {
  assetId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  textHash: string;
  textLength: number;
  providerType: VoiceGenerationProviderType;
  model: string;
  voice: string;
  format: VoiceGenerationFormat;
};

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  origin?: 'user-input' | 'assistant-reply' | 'system-note' | 'tool-runtime' | 'trigger-runtime';
  requestRole?: 'user' | 'assistant' | 'system';
  requestContent?: string;
  /**
   * 请求面的送达保证。`'always'` 表示这条消息的 `requestContent` 必须进入每一次
   * 模型请求，即使 provider 会对"易变 system 层"做省略（如 DeepSeek 的前缀缓存
   * 省略策略）也要豁免送达——用于通话接通/结束这类模型必须知道的状态事实。
   */
  requestDelivery?: 'always';
  attachments?: ChatAttachment[];
  providerId?: string;
  providerName?: string;
  model?: string;
  tokenCount?: number;
  tokenUsage?: ChatTokenUsage;
  memoryEvidence?: ChatMemoryEvidence;
  /** 这一轮从 Ombre-Brain 召回了什么；没开 OB 就是 undefined。 */
  obRecall?: ChatObRecallEvidence;
  assistantName?: string;
  speakerCollaboratorId?: string;
  thinkingText?: string;
  voiceCache?: ChatMessageVoiceCache;
  nativeToolCalls?: ChatNativeToolCall[];
  toolInvocation?: ToolInvocation;
  cardReference?: ChatCardReference;
}

export type ChatTokenUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
};

export type ChatMemoryEvidenceItemKind =
  | 'recent_tail'
  | 'matched_context'
  | 'voice_anchor'
  | 'vector_match';

export type ChatMemoryEvidenceChunkKind =
  | 'source_message'
  | 'user_intent'
  | 'dialogue_turn';

export type ChatMemoryEvidenceItem = {
  id: string;
  kind: ChatMemoryEvidenceItemKind;
  label: string;
  sourceConversationId: string | null;
  sourceMessageIds: string[];
  textExcerpt: string;
  estimatedTokens: number;
  charCount: number;
  score: number | null;
  memoryChunkKind?: ChatMemoryEvidenceChunkKind;
};

export type ChatMemoryEvidence = {
  requestId: string;
  strategy: 'none' | 'local_scan' | 'semantic_index';
  status: 'disabled' | 'not_configured' | 'empty' | 'within_budget' | 'trimmed_budget';
  items: ChatMemoryEvidenceItem[];
};

/**
 * 一轮 OB 召回的落地结果，挂在助手消息上给界面显示。
 *
 * `status` 只有两种：搜到了（可能 0 条）和没搜成。没搜成也要显示，
 * 否则用户以为开了 OB 在起作用，实际一次都没连上。
 */
export type ChatObRecallEvidence = {
  status: 'ok' | 'failed';
  count: number;
  /** 失败原因（超时、密码错、连不上），成功时没有。 */
  error?: string;
  items: {
    id: string;
    name: string;
    excerpt: string;
    /** OB 给的排序分：用来判「这条到底相关不相关」。 */
    score: number;
  }[];
};

export type WorkspaceLedgerEvent =
  | {
      id: string;
      kind: 'workspace_scope_changed';
      createdAt: number;
      change: 'entered' | 'exited' | 'switched';
      previousProjectId: string | null;
      nextProjectId: string | null;
      summary: string;
    }
  | {
      id: string;
      kind: 'workspace_proposal_resolved';
      createdAt: number;
      proposalId: string;
      decision: 'accepted' | 'rejected';
      summary: string;
    };

export type ConversationTaskStatus = 'running' | 'blocked' | 'completed' | 'cancelled';
export type ConversationTaskStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type ConversationTaskMode = 'seed' | 'active';

export interface ConversationTaskStep {
  id: string;
  title: string;
  status: ConversationTaskStepStatus;
  detail?: string;
}

export interface ConversationTaskExecution {
  id: string;
  assistantMessageId: string;
  toolCallIds: string[];
  resultMessageIds: string[];
  pendingProposalIds: string[];
  updatedAt: number;
}

export interface ConversationTaskState {
  id: string;
  sourceMessageId: string;
  goal: string;
  title: string;
  mode?: ConversationTaskMode;
  status: ConversationTaskStatus;
  stage: string;
  summary?: string;
  focus?: string;
  next?: string;
  steps: ConversationTaskStep[];
  executions: ConversationTaskExecution[];
  createdAt: number;
  updatedAt: number;
  lastAssistantMessageId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  kind?: 'direct' | 'group';
  collaboratorId: string | null;
  group?: GroupConversationState;
  groupRoomId?: string | null;
  activeProjectId?: string | null;
  messages: ChatMessage[];
  toolLedger?: ToolLedgerEntry[];
  workspaceLedger?: WorkspaceLedgerEvent[];
  task?: ConversationTaskState | null;
  draft?: string;
  pinnedAt: number | null;
  updatedAt: number;
}

export type GroupConversationReplyMode = 'round' | 'random';
export type GroupConversationToolSettings = {
  cards: boolean;
  images: boolean;
  attachments: boolean;
  web: boolean;
  mcp: boolean;
};
export type GroupConversationPrivateEntryKind = 'user-note' | 'assistant-note' | 'tool-summary' | 'system-note';
export type GroupConversationPrivateEntryAuthor = 'user' | 'collaborator' | 'tool' | 'system';

export interface GroupConversationPrivateEntry {
  id: string;
  kind: GroupConversationPrivateEntryKind;
  author: GroupConversationPrivateEntryAuthor;
  content: string;
  createdAt: number;
  publishedMessageId?: string;
}

export interface GroupConversationState {
  title: string;
  memberIds: string[];
  /** 同一个群（场所）下的多场对话共享一个血缘 id；产物按血缘归群 */
  lineageId?: string;
  background: string;
  backgroundAssetId?: string | null;
  backgroundVeil?: number;
  replyMode: GroupConversationReplyMode;
  allowMemberSilence: boolean;
  memoryRecallEnabled: boolean;
  toolSettings: GroupConversationToolSettings;
  privateLanes?: Record<string, GroupConversationPrivateEntry[]>;
  createdAt: number;
  updatedAt: number;
}

export type GroupChatReplyMode = 'round' | 'random';
export type GroupChatToolSettings = {
  cards: boolean;
};
export type GroupChatPrivateEntryKind = 'user-note' | 'assistant-note' | 'tool-summary' | 'system-note';
export type GroupChatPrivateEntryAuthor = 'user' | 'collaborator' | 'tool' | 'system';

export interface GroupChatPrivateEntry {
  id: string;
  kind: GroupChatPrivateEntryKind;
  author: GroupChatPrivateEntryAuthor;
  content: string;
  createdAt: number;
  publishedMessageId?: string;
}

export interface GroupChatRoom {
  id: string;
  title: string;
  memberIds: string[];
  activeConversationId: string | null;
  draft: string;
  background: string;
  replyMode: GroupChatReplyMode;
  allowMemberSilence: boolean;
  memoryRecallEnabled: boolean;
  toolSettings: GroupChatToolSettings;
  privateLanes?: Record<string, GroupChatPrivateEntry[]>;
  createdAt: number;
  updatedAt: number;
}

export interface ChatAttachment {
  id: string;
  assetId: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
  clearedAt?: number;
  sticker?: {
    id: string;
    name: string;
  };
}

