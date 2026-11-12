import { useEffect, useMemo, useRef, useState } from 'react';
import { buildConversationCardSummary } from '../../app/collection/conversationCardSummary';
import { closeHomeScreen } from '../../app/home/homeScreenStore';
import { resolveCollectionRenderItemCount } from '../../app/shell/collectionRenderLoad';
import { deriveAppShellState } from '../../app/shell/deriveAppShellState';
import { useAppShellStoreBindings } from '../../app/shell/useAppShellStoreBindings';
import { createCompanionPersonaProjection, isCompanionCollaboratorId } from '../../engines/companion';
import {
  conversationMatchesCollaboratorScope,
  resolveConversationCollaboratorId
} from '../../engines/conversationOwnership';
import { useCollectionShellState } from './useCollectionShellState';
import { useAppShellNavigationActions } from './useAppShellNavigationActions';
import { useCollaboratorFrontstageSync } from './useCollaboratorFrontstageSync';
import { useEditingCollaboratorFrontstageSync } from './useEditingCollaboratorFrontstageSync';
import { useAppShellOverlayController } from './useAppShellOverlayController';
import { useAppShellWorldController } from './useAppShellWorldController';
import { enterCollaboratorCollectionScope } from '../../app/shell/frontstageNavigation';
import { useThemeSessionActions } from '../../app/theme/useThemeSessionActions';
import { useAbortStreamingCleanupEffect } from '../worlds/chat/effects/useAbortStreamingCleanupEffect';
import { useChatUiState } from '../worlds/chat/context/ChatUiState';
import { useI18n } from '../../i18n';
import type { AppTriggerChatRuntimePort } from '../../app/shell/useAppTriggerRuntime';

export function useAppShellController() {
  const chatUi = useChatUiState();
  const { t } = useI18n();
  useAbortStreamingCleanupEffect(chatUi);
  const stores = useAppShellStoreBindings();
  const {
    space: {
      activeWorld,
      setWorld,
      toggleWorld,
      collectionShelf,
      setCollectionShelf,
      frontstageCollaboratorId,
      collectionProjectId,
      editingCollaboratorId,
      setFrontstageCollaboratorId,
      setEditingCollaboratorId,
      setActiveCard,
      spotlightCard,
      clearPendingAttachments,
      clearPendingCardReference,
      replyNotifications,
      dismissReplyNotification,
      activeThemePreview,
      theme,
      customization,
      displayPreferences
    },
    collaborator: {
      personas,
      activeCollaboratorId,
    },
    runtime: {
      companionConnections,
      companionSnapshots
    },
    chat: {
      conversations,
      loadedMessageConversationIds,
      activeConversationId,
      activeConversationTitle,
      activeConversationCollaboratorId,
      activeConversationMessageCount,
      createConversation,
      renameConversation,
      toggleConversationPinned,
      deleteConversation,
      setActiveConversation
    },
    collection: {
      collectionHydrated,
      collectionCards,
      imageCards,
      roomProjects,
      projectFiles,
      createCard,
      backfillOwnershipFromConversations
    }
  } = stores;
  const collaborators = useMemo(
    () => [
      ...personas,
      ...companionConnections.map((connection) =>
        createCompanionPersonaProjection(connection, companionSnapshots[connection.id] ?? null)
      )
    ],
    [companionConnections, companionSnapshots, personas]
  );
  const activeConversationCollaboratorName = collaborators.find((persona) => persona.id === activeConversationCollaboratorId)?.name ?? null;
  const frontstageCollaborator = collaborators.find((persona) => persona.id === frontstageCollaboratorId) ?? null;
  const frontstageCollaboratorName = frontstageCollaborator?.name ?? null;
  const collaboratorIds = useMemo(() => collaborators.map((collaborator) => collaborator.id), [collaborators]);
  const desktopSidebarConversations = useMemo(
    () => {
      const projectTitleById = new Map(roomProjects.map((project) => [project.id, project.title.trim() || t('common.untitledWorkspace')]));
      return conversations
        .filter((conversation) => conversationMatchesCollaboratorScope(conversation, frontstageCollaboratorId, collaboratorIds))
        .map((conversation) => {
          const summary = buildConversationCardSummary(conversation);
          return {
            ...summary,
            activeProjectTitle: summary.activeProjectId ? projectTitleById.get(summary.activeProjectId) ?? t('common.workspace') : null
          };
        });
    },
    [collaboratorIds, conversations, frontstageCollaboratorId, roomProjects, t]
  );
  const desktopSidebarShelfItems = useMemo(
    () => [
      { shelf: 'project' as const, label: t('common.workspace') },
      { shelf: 'code' as const, label: t('desktop.navCards') },
      { shelf: 'image' as const, label: t('desktop.navImages') },
      { shelf: 'info' as const, label: frontstageCollaboratorName ?? t('desktop.collaboratorSettings') }
    ],
    [frontstageCollaboratorName, t]
  );
  const collectionRenderItemCount = useMemo(
    () => resolveCollectionRenderItemCount({
      collectionShelf,
      frontstageCollaboratorId,
      knownCollaboratorIds: collaboratorIds,
      loadedMessageConversationIds,
      conversations,
      cards: collectionCards,
      imageCards,
      roomProjects,
      projectFiles
    }),
    [
      collaboratorIds,
      collectionShelf,
      frontstageCollaboratorId,
      loadedMessageConversationIds,
      conversations,
      collectionCards,
      imageCards,
      roomProjects,
      projectFiles
    ]
  );

  const collection = useCollectionShellState();
  // 对话内搜索面板的开合状态放在 shell 层：入口在顶栏（chat 世界），面板本身挂在
  // ChatWorld 里（那边才拿得到消息和聚焦能力）。
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const chatSearch = useMemo(() => ({
    open: chatSearchOpen,
    setOpen: setChatSearchOpen,
    close: () => setChatSearchOpen(false)
  }), [chatSearchOpen]);
  // 从 chat 世界按下左上角抽屉按钮时，抽屉只能长在 collection 世界里，
  // 所以会先把世界切过去。这里记住"是聊着天打开的"，关闭抽屉时再原路退回。
  const collaboratorDrawerReturnRef = useRef(false);
  const collaboratorDrawerWasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = collaboratorDrawerWasOpenRef.current;
    collaboratorDrawerWasOpenRef.current = collection.collaboratorSwitchOpen;
    if (wasOpen && !collection.collaboratorSwitchOpen && collaboratorDrawerReturnRef.current) {
      collaboratorDrawerReturnRef.current = false;
      setWorld('chat');
    }
  }, [collection.collaboratorSwitchOpen, setWorld]);

  const themeSession = useThemeSessionActions();
  const chatRuntimePort: AppTriggerChatRuntimePort = useMemo(() => ({
    generationByConversationId: chatUi.generationByConversationId,
    getConversationGenerationControls: chatUi.getConversationGenerationControls,
    setCommandStatus: chatUi.setCommandStatus,
    themeToolModeSwitchRef: chatUi.themeToolModeSwitchRef
  }), [
    chatUi.generationByConversationId,
    chatUi.getConversationGenerationControls,
    chatUi.setCommandStatus,
    chatUi.themeToolModeSwitchRef
  ]);

  useCollaboratorFrontstageSync({
    personas,
    activeCollaboratorId,
    frontstageCollaboratorId,
    setActiveCollaborator: stores.collaborator.setActiveCollaborator
  });
  useEditingCollaboratorFrontstageSync({
    personas,
    editingCollaboratorId,
    frontstageCollaboratorId,
    activeCollaboratorId,
    setEditingCollaboratorId
  });
  const derived = deriveAppShellState({
    activeWorld,
    activeThemePreview,
    personas: collaborators,
    frontstageCollaboratorId,
    activeConversationTitle,
    activeConversationCollaboratorId,
    activeConversationMessageCount,
    collectionRenderItemCount,
    labels: {
      collectionWorld: t('common.room'),
      chatWorld: t('common.conversation'),
      unnamedConversation: t('chat.untitledConversation')
    }
  });
  const navigationActions = useAppShellNavigationActions({
    previewConversationId: derived.previewConversationId,
    personas: collaborators,
    conversations,
    activeWorld,
    frontstageCollaboratorId,
    collectionProjectId,
    activeCollaboratorId,
    activeConversationId,
    activeConversationCollaboratorId,
    activeConversationProjectId: conversations.find((conversation) => conversation.id === activeConversationId)?.activeProjectId ?? null,
    setWorld,
    createConversation,
    setActiveConversation,
    clearPendingAttachments,
    clearPendingCardReference
  });
  const overlays = useAppShellOverlayController({
    stores,
    collection,
    frontstage: {
      frontstageCollaboratorId,
      editingCollaboratorId,
      activeWorld,
      collectionShelf,
      setFrontstageCollaboratorId,
      setEditingCollaboratorId,
      setActiveCard,
      spotlightCard,
      clearPendingAttachments,
      clearPendingCardReference,
      setWorld,
      setCollectionShelf
    }
  });
  const menuOpenedFromChatRef = useRef(false);
  const menuWasOpenRef = useRef(false);
  useEffect(() => {
    const menuOpen = overlays.modals.menuOpen;
    if (!menuWasOpenRef.current && menuOpen) {
      menuOpenedFromChatRef.current = activeWorld === 'chat';
    }
    if (menuWasOpenRef.current && !menuOpen) {
      if (menuOpenedFromChatRef.current && activeWorld !== 'chat') {
        setWorld('chat');
      }
      menuOpenedFromChatRef.current = false;
    }
    menuWasOpenRef.current = menuOpen;
  }, [activeWorld, overlays.modals.menuOpen, setWorld]);
  const world = useAppShellWorldController({
    activeWorld,
    activeThemePreview,
    theme,
    collectionShelf,
    toggleWorld,
    derived,
    collection,
    chatSearch,
    navigationActions,
    chatUi,
    toggleMenu: overlays.toggleMenu,
    openSettings: overlays.collectionOpenSettings,
    openToolbox: () => overlays.openMenuAt('toolbox'),
    openProviderSettings: overlays.collectionOpenProviderSettings
  });
  const desktopSidebarProps = {
    activeWorld,
    activeConversationId,
    collectionShelf,
    collaboratorScopeId: frontstageCollaboratorId,
    currentCollaborator: frontstageCollaborator,
    collaborators,
    conversations: desktopSidebarConversations,
    shelfItems: desktopSidebarShelfItems,
    onSelectCollaborator: (collaboratorId: string | null) => {
      enterCollaboratorCollectionScope({
        activeWorld,
        setFrontstageCollaboratorId,
        setCollectionShelf,
        setWorld
      }, collaboratorId);
      if (collaboratorId && !isCompanionCollaboratorId(collaboratorId)) {
        stores.collaborator.setActiveCollaborator(collaboratorId);
        setEditingCollaboratorId(collaboratorId);
      }
    },
    onCreateCollaboratorFromBuilder: () => {
      setWorld('collection');
      overlays.collectionOpenCollaboratorBuilderForCreate();
    },
    onCreateCustomCollaborator: () => {
      setWorld('collection');
      overlays.collectionCreateCustomCollaborator();
    },
    onSelectShelf: (shelf: typeof collectionShelf) => {
      if (shelf === 'info' && frontstageCollaboratorId) {
        setEditingCollaboratorId(frontstageCollaboratorId);
      }
      setCollectionShelf(shelf);
      setWorld('collection');
    },
    onOpenConversation: (conversationId: string) => {
      if (conversationId !== activeConversationId) {
        clearPendingAttachments();
        clearPendingCardReference();
      }
      // 点历史对话 = 进聊天，不能再停在上首页（同一个对话点第二次也要进去）。
      closeHomeScreen();
      setActiveConversation(conversationId);
      setWorld('chat');
    },
    onRenameConversation: renameConversation,
    onToggleConversationPinned: toggleConversationPinned,
    onDeleteConversation: (conversationId: string, title: string) => {
      if (!window.confirm(t('desktop.deleteConversationConfirm', { title }))) return;
      themeSession.rollbackPreviewForConversationDeletion(conversationId);
      deleteConversation(conversationId);
      if (conversationId === activeConversationId) {
        clearPendingAttachments();
        clearPendingCardReference();
      }
    },
    onCreateConversation: navigationActions.openFreshConversation,
    onOpenGroupWorld: () => {
      clearPendingAttachments();
      clearPendingCardReference();
      setWorld('group');
    },
    onOpenSettings: overlays.collectionOpenSettings
  };
  const openReplyNotification = (notification: typeof replyNotifications[number]) => {
    if (notification.conversationId !== activeConversationId) {
      clearPendingAttachments();
      clearPendingCardReference();
    }
    setFrontstageCollaboratorId(notification.collaboratorId);
    closeHomeScreen();
    setActiveConversation(notification.conversationId);
    setWorld('chat');
    dismissReplyNotification(notification.id);
  };
  return {
    activeWorld,
    onReturnToChat: () => setWorld('chat'),
    shellWorld: world.shellWorld,
    activeChatDensity: derived.activeChatDensity,
    customization,
    displayPreferences,
    themeTransitionPhase: world.themeTransitionPhase,
    worldPresence: world.worldPresence,
    collectionSearchOpen: collection.searchOpen,
    collectionCollaboratorSwitchOpen: collection.collaboratorSwitchOpen,
    setCollectionCollaboratorSwitchOpen: collection.setCollaboratorSwitchOpen,
    collectionInfoFullscreenOpen: collection.infoFullscreenOpen,
    setCollectionInfoFullscreenOpen: collection.setInfoFullscreenOpen,
    collectionDetailOpen: collection.detailOpen,
    setCollectionDetailOpen: collection.setDetailOpen,
    collectionOpenCollaboratorBuilderForCreate: overlays.collectionOpenCollaboratorBuilderForCreate,
    collectionCreateCustomCollaborator: overlays.collectionCreateCustomCollaborator,
    collectionOpenProviderSettings: overlays.collectionOpenProviderSettings,
    collectionOpenSettings: () => {
      const returnToChat = collaboratorDrawerReturnRef.current;
      overlays.collectionOpenSettings();
      if (returnToChat) {
        collaboratorDrawerReturnRef.current = false;
        setWorld('chat');
      }
    },
    openBackupSettings: () => overlays.openMenuAt('backup'),
    collectionOpenDesktopLocalSettings: overlays.collectionOpenDesktopLocalSettings,
    collectionDeleteCollaborator: overlays.collaboratorActions.deleteCollaboratorFromPanel,
    collectionDrawerNavigate: () => {
      collaboratorDrawerReturnRef.current = false;
    },
    canReviveTheme: overlays.canReviveTheme,
    restoreLastThemeSkin: overlays.restoreLastThemeSkin,
    restoreDefaultTheme: overlays.restoreDefaultTheme,
    topbarProps: {
      ...world.topbarProps,
      state: {
        ...world.topbarProps.state,
        menuOpen: overlays.modals.menuOpen
      },
      actions: {
        ...world.topbarProps.actions,
        onToggleCollaboratorSwitch: () => {
          const openedFromChat = !collection.collaboratorSwitchOpen && activeWorld === 'chat';
          world.topbarProps.actions.onToggleCollaboratorSwitch();
          collaboratorDrawerReturnRef.current = openedFromChat;
          if (openedFromChat) {
            setWorld('collection');
          }
        }
      }
    },
    chatRuntimePort,
    collectionOwnershipBackfillPort: {
      collectionHydrated,
      conversations,
      backfillOwnershipFromConversations
    },
    chatWorldProps: world.chatWorldProps,
    groupWorldProps: world.groupWorldProps,
    desktopSidebarProps,
    replyNotificationProps: {
      notifications: replyNotifications,
      activeWorld,
      activeConversationId,
      onOpen: openReplyNotification,
      onDismiss: dismissReplyNotification
    },
    overlaysProps: overlays.overlaysProps,
    screenshotDebugContext: {
      activeConversationTitle,
      activeConversationMessageCount,
      collectionRenderItemCount,
      activeConversationCollaboratorName,
      frontstageCollaboratorName
    },
    collaboratorTransitionKey: frontstageCollaboratorId ?? '__aggregate__'
  };
}






