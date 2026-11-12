import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  getDueTriggerRules,
  resolveActivitySkipRunAt,
  resolveIdleRearmRunAt,
  resolveLastUserActivityAt,
  shouldSkipTriggerForActivity
} from '../../engines/triggers';
import type { ChatMessage, PolarisTriggerRule } from '../../types/domain';
import type { ChatStoreBindings } from './useChatStoreBindings';
import { createTriggerMessage } from './triggerMessage';
import { resolveTriggerConversationForTarget } from './triggerConversationResolution';
import { buildProactiveReplyNotification } from './proactiveReplyNotification';
import { runProactiveDecision } from './proactiveDecisionRunner';
import { deliverProactivePlanRule } from './proactivePlanDelivery';
import { postNativeProactiveReplyNotification, registerNativeTriggerFiredListener } from '../../native/localTriggerNotifications';
import { selectChatConversations } from './liveConversationCatalog';

type TriggerGenerationState = {
  sending: boolean;
};

type UseChatTriggerRuntimeArgs = {
  startupReady: boolean;
  generationByConversationId: Record<string, TriggerGenerationState | undefined>;
  store: ChatStoreBindings;
  runReply: (params: {
    conversationId: string;
    collaboratorId: string;
    messages: ChatMessage[];
  }) => Promise<{ status: 'completed' | 'aborted' | 'failed' }>;
  setCommandStatus: (text: string, isError?: boolean) => void;
};

function resolveTriggerConversation(args: {
  rule: PolarisTriggerRule;
  store: ChatStoreBindings;
}) {
  const chatState = args.store.chat.readLatestState();
  const liveConversations = selectChatConversations(chatState.conversations);
  return resolveTriggerConversationForTarget(args.rule.target, {
    conversations: liveConversations,
    activeConversationId: chatState.activeConversationId
  }, {
    createConversation: (collaboratorId) => args.store.chat.createConversation(collaboratorId),
    getConversations: () => {
      const latest = args.store.chat.readLatestState();
      return selectChatConversations(latest.conversations);
    }
  });
}

/** 空闲规则重新计时的检查间隔。 */
const IDLE_REARM_INTERVAL_MS = 60_000;

/** 用户最后一次发言的时间；没有可用记录时返回 null。 */
function readLastUserActivityAt(store: ChatStoreBindings) {
  const chatState = store.chat.readLatestState();
  return resolveLastUserActivityAt(selectChatConversations(chatState.conversations));
}

export function useChatTriggerRuntime({
  startupReady,
  generationByConversationId,
  store,
  runReply,
  setCommandStatus
}: UseChatTriggerRuntimeArgs) {
  const runningRuleIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const generationByConversationIdRef = useRef(generationByConversationId);
  const storeRef = useRef(store);
  const [wakeTick, setWakeTick] = useState(0);

  useEffect(() => {
    generationByConversationIdRef.current = generationByConversationId;
  }, [generationByConversationId]);

  // 用 ref 持有 store，避免 store 每次渲染换引用时把下面的定时器反复拆掉重建，
  // 导致重新计时的 interval 永远等不到第一次触发。
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!startupReady || typeof window === 'undefined') return;

    const wake = () => setWakeTick((current) => current + 1);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') wake();
    };

    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let cancelled = false;
    let removeResumeListener: (() => void) | null = null;

    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('App')) {
      void CapacitorApp.addListener('resume', wake).then((listener) => {
        if (cancelled) {
          void listener.remove();
          return;
        }
        removeResumeListener = () => {
          void listener.remove();
        };
      });
    }

    // 原生精确闹钟到点信号：系统在锁屏/后台拉起 PolarisTriggerAlarmReceiver 后，
    // 会广播 triggerFired。这里收到就立刻做一次到期扫描，把"决策层 + 生成真实回复"跑起来。
    let removeTriggerFiredListener: (() => void) | null = null;
    void registerNativeTriggerFiredListener(() => {
      if (!cancelled) wake();
    }).then((listener) => {
      if (cancelled) {
        void listener?.remove();
        return;
      }
      removeTriggerFiredListener = listener ? () => void listener.remove() : null;
    });

    return () => {
      cancelled = true;
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeResumeListener?.();
      removeTriggerFiredListener?.();
    };
  }, [startupReady]);

  useEffect(() => {
    if (!startupReady) return;
    const nextRunAt = store.runtime.triggerRules
      .filter((rule) => rule.enabled && rule.nextRunAt !== null)
      .map((rule) => rule.nextRunAt!)
      .sort((left, right) => left - right)[0];
    if (!nextRunAt) return;

    const delay = Math.max(0, nextRunAt - Date.now());
    const timer = window.setTimeout(
      () => setWakeTick((current) => current + 1),
      Math.min(delay, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [startupReady, store.runtime.triggerRules]);

  // 空闲规则的计时是"活的"：用户每说一句话，到期时刻就整体后推到 最后活跃 + 阈值。
  // 只在用户真的安静够久之后，nextRunAt 才会落到现在之前，规则才可能到期。
  useEffect(() => {
    if (!startupReady) return;

    const rearmIdleRules = () => {
      const runtimeState = storeRef.current.runtime.readLatestState();
      const idleRules = runtimeState.triggerRules.filter(
        (entry) => entry.enabled && entry.schedule.kind === 'idle'
      );
      if (idleRules.length === 0) return;

      const lastActivityAt = readLastUserActivityAt(storeRef.current);
      for (const idleRule of idleRules) {
        const nextRunAt = resolveIdleRearmRunAt(idleRule, lastActivityAt);
        if (nextRunAt === null || nextRunAt === idleRule.nextRunAt) continue;
        storeRef.current.runtime.updateTriggerRule(idleRule.id, { nextRunAt });
      }
    };

    rearmIdleRules();
    const timer = window.setInterval(rearmIdleRules, IDLE_REARM_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [startupReady, wakeTick]);

  useEffect(() => {
    if (!startupReady || runningRuleIdRef.current) return;

    const runtimeState = store.runtime.readLatestState();
    const [rule] = getDueTriggerRules(runtimeState.triggerRules);
    if (!rule) return;

    // 到期不等于现在该打扰。用户刚刚还在说话时，这次主动消息的前提已经不成立，
    // 直接跳过并把规则顺延，不写消息也不记失败。
    //
    // 但这条活跃保护只对「空闲」类规则有意义：空闲消息的潜台词是「你很久没来了」，
    // 人还在自然不该打扰。而「每隔 X 分钟」和「每天 X 点」是用户明确要求的定时提醒，
    // 语义上就该无视活跃状态照发——否则用户一边测试一边说话，短间隔规则会被永远静默跳过，
    // 一条消息都收不到（这正是此前「开着 App 也没消息」的根因）。
    const lastActivityAt = readLastUserActivityAt(store);
    if (rule.schedule.kind === 'idle' && shouldSkipTriggerForActivity({ lastActivityAt })) {
      store.runtime.updateTriggerRule(rule.id, {
        nextRunAt: resolveActivitySkipRunAt(rule, lastActivityAt)
      });
      return;
    }

    runningRuleIdRef.current = rule.id;

    void (async () => {
      try {
        if (rule.mode === 'proactive-plan') {
          await deliverProactivePlanRule({
            rule,
            store,
            runReply,
            setCommandStatus,
            isMounted: () => mountedRef.current,
            isSending: (conversationId) => Boolean(generationByConversationIdRef.current[conversationId]?.sending)
          });
          return;
        }

        const persona = store.persona.readLatestState().personas.find((entry) => entry.id === rule.target.collaboratorId) ?? null;
        if (!persona) {
          store.runtime.markTriggerFailed(rule.id, `目标人格不存在：${rule.target.collaboratorId}`);
          return;
        }

        const conversation = resolveTriggerConversation({ rule, store });
        if (!conversation) {
          store.runtime.markTriggerFailed(rule.id, '无法创建触发器对话');
          return;
        }
        if (generationByConversationIdRef.current[conversation.id]?.sending) {
          return;
        }

        const writableConversation = await store.chat.ensureConversationWritable(conversation.id);
        if (!writableConversation) {
          store.runtime.markTriggerFailed(rule.id, '触发器对话历史还没准备好');
          return;
        }

        // 到期、且用户确实安静够久了，也不等于现在就该开口。
        // 真正投递前先让协作者自己的模型读一遍上下文做一次判断；判断为不该开口时
        // 直接顺延，不写消息、不记失败——它只是"这次先不说"，不是执行出错。
        const runtimeState = storeRef.current.runtime.readLatestState();
        const decision = await runProactiveDecision({
          persona,
          globalApi: runtimeState.api,
          providers: runtimeState.providers,
          rule,
          messages: writableConversation.messages,
          lastActivityAt,
          now: Date.now()
        });
        if (!mountedRef.current) return;
        if (!decision.send) {
          store.runtime.updateTriggerRule(rule.id, {
            nextRunAt: resolveActivitySkipRunAt(rule, lastActivityAt)
          });
          setCommandStatus(`本次主动消息已跳过：${decision.reason || '模型判断现在开口不合适'}`);
          return;
        }

        const triggerEvent = store.runtime.consumeTriggerEvent(rule.id);
        const triggerMessage = createTriggerMessage(rule, triggerEvent, decision.message);
        const nextMessages = [...writableConversation.messages, triggerMessage];
        const messageCountBeforeReply = nextMessages.length;
        store.chat.addMessage(writableConversation, triggerMessage);
        store.runtime.markTriggerFired(rule.id, Date.now(), lastActivityAt);
        setCommandStatus(`触发器已投递：${rule.name}`);

        const result = await runReply({
          conversationId: writableConversation.conversationId,
          collaboratorId: rule.target.collaboratorId,
          messages: nextMessages
        });

        if (result.status !== 'aborted' && mountedRef.current) {
          const latestChatState = store.chat.readLatestState();
          const latestSpaceState = store.space.readLatestState();
          const latestConversation = latestChatState.conversations.find((entry) => entry.id === writableConversation.conversationId) ?? null;
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
      } catch (error) {
        const message = error instanceof Error ? error.message : '触发器执行失败';
        store.runtime.markTriggerFailed(rule.id, message);
        setCommandStatus(`触发器失败：${message}`, true);
      } finally {
        if (runningRuleIdRef.current === rule.id) {
          runningRuleIdRef.current = null;
        }
      }
    })();
  }, [runReply, setCommandStatus, startupReady, store, wakeTick]);
}
