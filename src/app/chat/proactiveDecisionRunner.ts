import { requestAssistantReply } from '../../engines/chatApi';
import type { RequestAssistantReplyParams } from '../../engines/chat-api/chatApiTypes';
import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import {
  buildProactiveDecisionRequestContext,
  parseProactiveDecisionOutput,
  PROACTIVE_DECISION_FALLBACK,
  type ProactiveDecision,
  type ProactiveDecisionPromptArgs
} from '../../engines/proactiveDecision';
import type { Persona, ProviderProfile } from '../../types/domain';

/** 便于测试替换的一次性补全入口。 */
export type ProactiveDecisionRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<{ content: string }>;

export type RunProactiveDecisionArgs = {
  persona: Persona;
  /** 全局 provider（runtimeStore 的当前 api）。 */
  globalApi: ProviderProfile;
  /** 可见 provider 列表（runtimeStore 的 providers）。 */
  providers: ProviderProfile[];
  rule: ProactiveDecisionPromptArgs['rule'];
  messages: ProactiveDecisionPromptArgs['messages'];
  lastActivityAt: number | null;
  now?: number;
  signal?: AbortSignal;
  requestReply?: ProactiveDecisionRequestReply;
};

/**
 * 跑一次主动消息决策。
 *
 * provider 解析复用协作者自己的绑定（`persona.advanced.providerId` / `modelOverride`，
 * 没绑定就退回全局 provider），这样决策用的就是「他自己」的模型，不会串到别人身上。
 *
 * 任何失败都退回 `PROACTIVE_DECISION_FALLBACK`（照常触发），不阻断原有链路。
 */
export async function runProactiveDecision(
  args: RunProactiveDecisionArgs
): Promise<ProactiveDecision> {
  const now = args.now ?? Date.now();
  const api = resolvePersonaProviderBinding({
    globalApi: args.globalApi,
    providers: args.providers,
    persona: args.persona
  }).api;

  const requestReply = args.requestReply ?? requestAssistantReply;

  try {
    const reply = await requestReply({
      api,
      context: buildProactiveDecisionRequestContext({
        rule: args.rule,
        collaboratorName: args.persona.name,
        messages: args.messages,
        lastActivityAt: args.lastActivityAt,
        now
      }),
      advanced: {
        providerId: api.id,
        modelOverride: api.model,
        temperature: '0.2',
        topP: '',
        maxTokens: '',
        thinkingBudget: '',
        contextMessageLimit: '',
        showThinking: false,
        streaming: false,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        regexTriggers: '',
        snippets: []
      },
      signal: args.signal
    });

    return parseProactiveDecisionOutput(reply.content);
  } catch {
    return { ...PROACTIVE_DECISION_FALLBACK };
  }
}
