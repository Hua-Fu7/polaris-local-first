import type {
  ConversationSummaryModelSettings,
  ImageGenerationSettings,
  MemoryVectorRetrievalSettings,
  Persona,
  VoiceGenerationSettings,
  VoiceTranscriptionSettings
} from '../../types/domain';

type UseMenuGenerationSettingsControllerArgs = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  conversationSummaryModel: ConversationSummaryModelSettings;
  memoryVectorRetrieval: MemoryVectorRetrievalSettings;
  imageGeneration: ImageGenerationSettings;
  voiceGeneration: VoiceGenerationSettings;
  voiceTranscription: VoiceTranscriptionSettings;
  setConversationSummaryModel: (patch: Partial<ConversationSummaryModelSettings>) => void;
  setMemoryVectorRetrieval: (patch: Partial<MemoryVectorRetrievalSettings>) => void;
  setImageGeneration: (patch: Partial<ImageGenerationSettings>) => void;
  setVoiceGeneration: (patch: Partial<VoiceGenerationSettings>) => void;
  setVoiceTranscription: (patch: Partial<VoiceTranscriptionSettings>) => void;
};

export function isMenuMemorySearchAvailable(
  activePersona: Pick<Persona, 'memory'> | null,
  memoryVectorRetrieval: MemoryVectorRetrievalSettings
) {
  return Boolean(activePersona)
    && (activePersona?.memory?.crossConversationRecallEnabled !== false || memoryVectorRetrieval.enabled === true);
}

export function useMenuGenerationSettingsController({
  personas,
  activeCollaboratorId,
  conversationSummaryModel,
  memoryVectorRetrieval,
  imageGeneration,
  voiceGeneration,
  voiceTranscription,
  setConversationSummaryModel,
  setMemoryVectorRetrieval,
  setImageGeneration,
  setVoiceGeneration,
  setVoiceTranscription
}: UseMenuGenerationSettingsControllerArgs) {
  const activePersona = personas.find((persona) => persona.id === activeCollaboratorId) ?? null;

  return {
    conversationSummaryModel,
    memoryVectorRetrieval,
    memorySearchAvailable: isMenuMemorySearchAvailable(activePersona, memoryVectorRetrieval),
    imageGeneration,
    voiceGeneration,
    voiceTranscription,
    onSetConversationSummaryModel: setConversationSummaryModel,
    onSetMemoryVectorRetrieval: setMemoryVectorRetrieval,
    onSetImageGeneration: setImageGeneration,
    onSetVoiceGeneration: setVoiceGeneration,
    onSetVoiceTranscription: setVoiceTranscription
  };
}
