import { requestAssistantReply } from '../../engines/chatApi';
import type { RequestAssistantReplyParams } from '../../engines/chat-api/chatApiTypes';
import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import {
  buildProactivePlanRequestContext,
  parseProactivePlanOutput,
  type ProactivePlan
} from '../../engines/proactiveContact';
import type { ChatMessage, Persona, ProviderProfile } from '../../types/domain';

export type ProactivePlanRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<{ content: string }>;

export type RunProactivePlanArgs = {
  persona: Persona;
  globalApi: ProviderProfile;
  providers: ProviderProfile[];
  messages: ChatMessage[];
  now?: number;
  signal?: AbortSignal;
  requestReply?: ProactivePlanRequestReply;
  userName?: string;
};

export async function runProactivePlan(
  args: RunProactivePlanArgs
): Promise<ProactivePlan | null> {
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
      context: buildProactivePlanRequestContext({
        messages: args.messages,
        collaboratorName: args.persona.name,
        userName: args.userName,
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

    return parseProactivePlanOutput(reply.content);
  } catch {
    return null;
  }
}