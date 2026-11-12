import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { useSpaceStore } from '../../stores/spaceStore';
import type { AssetGovernanceReferences } from '../../engines/assetGovernance';
import { readStableCompleteChatConversationsForDerivedDataWork } from './derivedDataWork';
import { loadWorkspaceReferenceDocsContent } from '../../stores/workspaceReferenceDocContentPersistence';
import { listStickerAttachments } from '../../engines/stickers/stickerLibrary';

export async function buildStableAssetGovernanceReferences(): Promise<AssetGovernanceReferences> {
  const conversations = await readStableCompleteChatConversationsForDerivedDataWork('asset_audit');
  const collectionState = useCollectionStore.getState();
  const spaceState = useSpaceStore.getState();
  const workspaceReferenceDocs = await loadWorkspaceReferenceDocsContent(collectionState.workspaceReferenceDocs);

  return {
    conversations,
    codeCards: collectionState.cards,
    imageCards: collectionState.imageCards,
    projectFiles: collectionState.projectFiles,
    workspaceReferenceDocs,
    roomProjects: collectionState.roomProjects,
    personas: usePersonaStore.getState().personas,
    theme: spaceState.theme,
    collaboratorThemes: spaceState.collaboratorThemes,
    customization: spaceState.customization,
    pendingAttachments: [...spaceState.pendingAttachments, ...listStickerAttachments()]
  };
}

export async function buildLiveAssetGovernanceReferences(): Promise<AssetGovernanceReferences> {
  const collectionState = useCollectionStore.getState();
  const spaceState = useSpaceStore.getState();
  const workspaceReferenceDocs = await loadWorkspaceReferenceDocsContent(collectionState.workspaceReferenceDocs);

  return {
    conversations: useChatStore.getState().conversations,
    codeCards: collectionState.cards,
    imageCards: collectionState.imageCards,
    projectFiles: collectionState.projectFiles,
    workspaceReferenceDocs,
    roomProjects: collectionState.roomProjects,
    personas: usePersonaStore.getState().personas,
    theme: spaceState.theme,
    collaboratorThemes: spaceState.collaboratorThemes,
    customization: spaceState.customization,
    pendingAttachments: [...spaceState.pendingAttachments, ...listStickerAttachments()]
  };
}
