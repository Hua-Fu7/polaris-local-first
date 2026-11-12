import {
  findProactiveSettingsRule,
  isQuietHour,
  localDayKey,
  moveOutOfQuietHours,
  resolveProactiveSettings,
  resolveTodayProactiveSentCount
} from '../../engines/proactiveContact';
import type { ChatMessage, PolarisTriggerRule } from '../../types/domain';
import { postNativeProactiveReplyNotification } from '../../native/localTriggerNotifications';
import type { ChatStoreBindings } from './useChatStoreBindings';
import { buildProactiveReplyNotification } from './proactiveReplyNotification';
import { createTriggerMessage } from './triggerMessage';

type RunTriggerReply = (params: {
  conversationId: string;
  collaboratorId: string;
  messages: ChatMessage[];
}) => Promise<{ status: 'completed' | 'aborted' | 'failed' }>;

export async function deliverProactivePlanRule(args: {
  rule: PolarisTriggerRule;
  store: ChatStoreBindings;
  runReply: RunTriggerReply;
  setCommandStatus: (text: string, isError?: boolean) => void;
  isMounted: () => boolean;
  isSending: (conversationId: string) => boolean;
}) {
  const { rule, store, runReply, setCommandStatus, isMounted, isSending } = args;
  const now = Date.now();
  const runtimeState = store.runtime.readLatestState();
  const settingsRule = findProactiveSettingsRule(runtimeState.triggerRules, rule.target.collaboratorId);
  const settings = resolveProactiveSettings(settingsRule);

  if (!settingsRule || !settings.enabled) {
    store.runtime.deleteTriggerRule(rule.id);
    return;
  }

  if (isQuietHour(now, settings)) {
    store.runtime.updateTriggerRule(rule.id, {
      nextRunAt: moveOutOfQuietHours(now + 30 * 60_000, settings)
    });
    return;
  }

  const sentToday = resolveTodayProactiveSentCount(settings, now);
  if (sentToday >= settings.maxPerDay) {
    store.runtime.deleteTriggerRule(rule.id);
    return;
  }

  const chatState = store.chat.readLatestState();
  const conversation = chatState.conversations.find((entry) => entry.id === rule.target.conversationId) ?? null;
  if (!conversation) {
    store.runtime.deleteTriggerRule(rule.id);
    return;
  }
  if (isSending(conversation.id)) {
    store.runtime.updateTriggerRule(rule.id, { nextRunAt: now + 5 * 60_000 });
    return;
  }

  const writableConversation = await store.chat.ensureConversationWritable(conversation.id);
  if (!writableConversation) {
    store.runtime.updateTriggerRule(rule.id, { nextRunAt: now + 30 * 60_000 });
    return;
  }

  const triggerMessage = createTriggerMessage(rule, null, rule.action.prompt);
  const nextMessages = [...writableConversation.messages, triggerMessage];
  const messageCountBeforeReply = nextMessages.length;
  store.chat.addMessage(writableConversation, triggerMessage);
  setCommandStatus('主动预约已投递');

  const result = await runReply({
    conversationId: writableConversation.conversationId,
    collaboratorId: rule.target.collaboratorId,
    messages: nextMessages
  });

  if (result.status === 'failed') {
    store.runtime.updateTriggerRule(rule.id, { nextRunAt: now + 30 * 60_000 });
    return;
  }
  if (result.status === 'aborted' || !isMounted()) {
    store.runtime.updateTriggerRule(rule.id, { nextRunAt: now + 5 * 60_000 });
    return;
  }

  const latestRuntimeState = store.runtime.readLatestState();
  const latestSettings = resolveProactiveSettings(
    findProactiveSettingsRule(latestRuntimeState.triggerRules, rule.target.collaboratorId)
  );
  store.runtime.updateTriggerRule(settingsRule.id, {
    proactiveSettings: {
      ...latestSettings,
      day: localDayKey(now),
      sentToday: resolveTodayProactiveSentCount(latestSettings, now) + 1
    }
  });
  store.runtime.deleteTriggerRule(rule.id);

  const latestChatState = store.chat.readLatestState();
  const latestSpaceState = store.space.readLatestState();
  const latestConversation = latestChatState.conversations.find((entry) => entry.id === writableConversation.conversationId) ?? null;
  const persona = store.persona.readLatestState().personas.find((entry) => entry.id === rule.target.collaboratorId) ?? null;
  if (!persona) return;

  const notification = buildProactiveReplyNotification({
    conversation: latestConversation,
    collaboratorId: rule.target.collaboratorId,
    collaboratorName: persona.name,
    messageCountBeforeReply,
    currentView: {
      activeWorld: latestSpaceState.activeWorld,
      activeConversationId: latestChatState.activeConversationId
    }
  });
  if (notification) {
    store.space.enqueueReplyNotification(notification);
    void postNativeProactiveReplyNotification(notification);
  }
}