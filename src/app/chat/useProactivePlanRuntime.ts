import { useEffect, useRef } from 'react';
import {
  findProactivePlanRule,
  findProactiveSettingsRule,
  moveOutOfQuietHours,
  resolveProactiveSettings,
  resolveTodayProactiveSentCount
} from '../../engines/proactiveContact';
import type {
  Conversation,
  Persona,
  PolarisTriggerRule,
  ProviderProfile
} from '../../types/domain';
import { isGroupConversation } from '../../engines/conversationOwnership';
import { runProactivePlan } from './proactivePlanRunner';

type UseProactivePlanRuntimeArgs = {
  startupReady: boolean;
  conversations: Conversation[];
  personas: Persona[];
  triggerRules: PolarisTriggerRule[];
  globalApi: ProviderProfile;
  providers: ProviderProfile[];
  createTriggerRule: (seed: {
    name?: string;
    mode?: PolarisTriggerRule['mode'];
    schedule: PolarisTriggerRule['schedule'];
    target: PolarisTriggerRule['target'];
    action: PolarisTriggerRule['action'];
    proactiveSettings?: PolarisTriggerRule['proactiveSettings'];
    sourceMessageId?: string;
    nextRunAt?: number | null;
  }) => string;
  updateTriggerRule: (ruleId: string, patch: Partial<PolarisTriggerRule>) => void;
  deleteTriggerRule: (ruleId: string) => void;
};

function latestAssistantReply(conversation: Conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === 'assistant' && message.origin === 'assistant-reply' && message.content.trim()) {
      return message;
    }
  }
  return null;
}

export function useProactivePlanRuntime({
  startupReady,
  conversations,
  personas,
  triggerRules,
  globalApi,
  providers,
  createTriggerRule,
  updateTriggerRule,
  deleteTriggerRule
}: UseProactivePlanRuntimeArgs) {
  const initializedRef = useRef(false);
  const seenRepliesRef = useRef(new Set<string>());
  const initializedUserMessagesRef = useRef(false);
  const seenUserMessagesRef = useRef(new Set<string>());

  useEffect(() => {
    if (!startupReady) return;

    const userMessageKeys = conversations.flatMap((conversation) =>
      conversation.messages
        .filter((message) => message.role === 'user' && message.origin === 'user-input')
        .map((message) => `${conversation.id}:${message.id}`)
    );
    if (!initializedUserMessagesRef.current) {
      initializedUserMessagesRef.current = true;
      seenUserMessagesRef.current = new Set(userMessageKeys);
    } else {
      const newUserMessages = userMessageKeys.filter((key) => !seenUserMessagesRef.current.has(key));
      for (const key of newUserMessages) {
        seenUserMessagesRef.current.add(key);
        const separatorIndex = key.lastIndexOf(':');
        const conversationId = separatorIndex > 0 ? key.slice(0, separatorIndex) : key;
        const existingPlan = findProactivePlanRule(triggerRules, conversationId);
        if (existingPlan) deleteTriggerRule(existingPlan.id);
      }
    }

    const candidates = conversations.flatMap((conversation) => {
      if (isGroupConversation(conversation)) return [];
      const collaboratorId = conversation.collaboratorId;
      if (!collaboratorId) return [];
      const reply = latestAssistantReply(conversation);
      if (!reply) return [];
      const key = `${conversation.id}:${reply.id}`;
      return [{ conversation, collaboratorId, reply, key }];
    });

    if (!initializedRef.current) {
      initializedRef.current = true;
      seenRepliesRef.current = new Set(candidates.map((candidate) => candidate.key));
      for (const candidate of candidates) {
        const existingPlan = findProactivePlanRule(triggerRules, candidate.conversation.id);
        if (existingPlan && existingPlan.sourceMessageId !== candidate.reply.id) {
          deleteTriggerRule(existingPlan.id);
        }
      }
      return;
    }

    const pending = candidates.filter((candidate) => !seenRepliesRef.current.has(candidate.key));
    for (const candidate of pending) {
      seenRepliesRef.current.add(candidate.key);
    }
    if (pending.length === 0) return;

    void (async () => {
      for (const { conversation, collaboratorId, reply } of pending) {
        const settingsRule = findProactiveSettingsRule(triggerRules, collaboratorId);
        const settings = resolveProactiveSettings(settingsRule);
        if (!settings.enabled || !settingsRule) continue;

        const existingPlan = findProactivePlanRule(triggerRules, conversation.id);
        if (existingPlan?.sourceMessageId === reply.id) continue;
        if (resolveTodayProactiveSentCount(settings) >= settings.maxPerDay) {
          if (existingPlan) deleteTriggerRule(existingPlan.id);
          continue;
        }

        const persona = personas.find((entry) => entry.id === collaboratorId);
        if (!persona) continue;
        const plan = await runProactivePlan({
          persona,
          globalApi,
          providers,
          messages: conversation.messages,
          now: Date.now(),
          userName: '用户'
        });

        if (!plan) {
          if (existingPlan) deleteTriggerRule(existingPlan.id);
          continue;
        }

        const at = moveOutOfQuietHours(Date.now() + plan.delayMinutes * 60_000, settings);
        const seed = {
          name: '主动预约',
          mode: 'proactive-plan' as const,
          schedule: { kind: 'interval' as const, everyMinutes: plan.delayMinutes },
          target: {
            collaboratorId,
            conversationMode: 'fixed' as const,
            conversationId: conversation.id
          },
          action: { prompt: plan.hint },
          sourceMessageId: reply.id,
          nextRunAt: at
        };

        if (existingPlan) {
          updateTriggerRule(existingPlan.id, seed);
        } else {
          createTriggerRule(seed);
        }
      }
    })();
  }, [
    conversations,
    createTriggerRule,
    deleteTriggerRule,
    globalApi,
    personas,
    providers,
    startupReady,
    triggerRules,
    updateTriggerRule
  ]);
}