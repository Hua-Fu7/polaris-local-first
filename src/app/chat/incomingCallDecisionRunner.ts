import { requestAssistantReply } from '../../engines/chatApi';
import type { RequestAssistantReplyParams } from '../../engines/chat-api/chatApiTypes';
import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import {
  buildIncomingCallDecisionRequestContext,
  INCOMING_CALL_ANSWER_TOOL_NAME,
  parseIncomingCallDecisionOutput,
  type IncomingCallDecision
} from '../../engines/incomingCallDecision';
import type { ChatMessage, Persona, ProviderProfile } from '../../types/domain';

/** 便于测试替换的一次性补全入口。 */
export type IncomingCallDecisionRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<{ content: string; nativeToolCalls?: IncomingCallDecisionToolCall[] }>;

/** 只用到工具名和参数文本，不必依赖 provider-runtime 的完整类型。 */
export type IncomingCallDecisionToolCall = {
  name: string;
  argumentsText?: string;
};

export type RunIncomingCallDecisionArgs = {
  persona: Persona;
  /** 全局 provider（runtimeStore 的当前 api）。 */
  globalApi: ProviderProfile;
  /** 可见 provider 列表（runtimeStore 的 providers）。 */
  providers: ProviderProfile[];
  messages: ChatMessage[];
  now?: number;
  signal?: AbortSignal;
  requestReply?: IncomingCallDecisionRequestReply;
};

/**
 * 跑一次「这通电话接不接」的判断。
 *
 * provider 解析复用协作者自己的绑定（`persona.advanced.providerId` / `modelOverride`，
 * 没绑定就退回全局 provider），这样判断用的就是「他自己」的模型。
 *
 * 失败一律返回 null，也就是接不上——和主动消息决策层的「失败照常触发」正好相反：
 * 这里没有可用的模型就意味着没有人能决定开门，把电话硬接起来等于替角色说话。
 */
export async function runIncomingCallDecision(
  args: RunIncomingCallDecisionArgs
): Promise<IncomingCallDecision | null> {
  const now = args.now ?? Date.now();
  const api = resolvePersonaProviderBinding({
    globalApi: args.globalApi,
    providers: args.providers,
    persona: args.persona
  }).api;

  if (!api.baseUrl?.trim() || !api.model?.trim()) return null;

  const requestReply = args.requestReply ?? requestAssistantReply;

  try {
    const reply = await requestReply({
      api,
      context: buildIncomingCallDecisionRequestContext({
        persona: args.persona,
        messages: args.messages,
        now
      }),
      // 判断层只有一个动作可选，必须强制模型调用 answerVoiceCall 工具，
      // 而不是让它「开口说」人话再由我们猜——否则第三方模型会把 tool_choice
      // 降级成 auto、改用自然语言表态，拒接就退化成"从话里抠意图"了。
      forceToolChoice: true,
      advanced: {
        providerId: api.id,
        modelOverride: api.model,
        // 比决策层稍高：这里要的是「像这个人」，不是可复现的判断。
        temperature: '0.6',
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

    const decision = readIncomingCallDecision(reply);
    // 来电判断的诊断日志：模型到底有没有调工具、返回了什么、解析成了什么。
    // 排查「角色拒绝不了电话」这类问题，靠这一条就能定位。
    // 用 JSON.stringify 而不是对象：WebView 的 console.info 传对象到 logcat 只会显示 [object Object]。
    try {
      console.info('[polaris-incoming-call]', JSON.stringify({
        provider: api.id,
        model: api.model,
        toolCalls: (reply.nativeToolCalls ?? []).map((c) => ({
          name: c.name,
          args: c.argumentsText ?? ''
        })),
        content: (reply.content ?? '').slice(0, 400),
        decision
      }));
    } catch {
      // 日志失败不影响判断结果。
    }
    return decision;
  } catch {
    return null;
  }
}

/**
 * 先读工具调用，读不到再退回文本。
 *
 * 工具调用是主路：结论在参数里，`accept` 是个布尔字段，含糊不了。
 * 文本那条路是给「provider 不支持原生工具、被兼容层降级掉」的情况留的
 * （`requestAssistantReply` 在 disableNativeTools 时会把 tools 和 toolChoice 一起清掉，
 * 这时模型只能按 system prompt 的第二方案输出 JSON）。
 */
export function readIncomingCallDecision(reply: {
  content: string;
  nativeToolCalls?: IncomingCallDecisionToolCall[];
}): IncomingCallDecision | null {
  const call = reply.nativeToolCalls?.find(
    (entry) => entry.name === INCOMING_CALL_ANSWER_TOOL_NAME
  ) ?? reply.nativeToolCalls?.[0];

  if (call?.argumentsText?.trim()) {
    const fromTool = parseIncomingCallDecisionOutput(call.argumentsText);
    if (fromTool) return fromTool;
  }

  return parseIncomingCallDecisionOutput(reply.content);
}
