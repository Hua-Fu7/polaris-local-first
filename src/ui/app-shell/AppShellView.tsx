import { Suspense } from 'react';
import { useEffect } from 'react';
import { useSpaceStore } from '../../stores/spaceStore';
import { AppShellOverlays } from '../AppShellOverlays';
import { ChaoticOrbitLoader } from '../shell/ChaoticOrbitLoader';
import { AppReplyNotificationStack } from './AppReplyNotificationStack';
import { DesktopAppShellFrame } from './DesktopAppShellFrame';
import { MobileAppShellFrame } from './MobileAppShellFrame';
import { PersistenceReadFailureNotice } from './PersistenceReadFailureNotice';
import { WorldFrameBoundary, WorldFrameFallback } from './WorldFrameBoundary';
import type { useAppShellViewController } from './useAppShellViewController';

type AppShellViewProps = ReturnType<typeof useAppShellViewController>;

export function AppShellView({
  activeWorld,
  onReturnToChat,
  shellWorld,
  activeChatDensity,
  customization,
  displayPreferences,
  themeTransitionPhase,
  worldPresence,
  collectionSearchOpen,
  collectionCollaboratorSwitchOpen,
  setCollectionCollaboratorSwitchOpen,
  collectionInfoFullscreenOpen,
  setCollectionInfoFullscreenOpen,
  collectionDetailOpen,
  setCollectionDetailOpen,
  collectionOpenCollaboratorBuilderForCreate,
  collectionCreateCustomCollaborator,
  collectionOpenProviderSettings,
  collectionOpenSettings,
  collectionOpenDesktopLocalSettings,
  collectionDeleteCollaborator,
  collectionDrawerNavigate,
  collaboratorTransitionKey,
  topbarProps,
  chatWorldProps,
  groupWorldProps,
  desktopSidebarProps,
  replyNotificationProps,
  overlaysProps,
  startupThemeReady,
  persistenceReadFailureNotice,
  onRetryPersistenceReadFailure,
  onOpenBackupFromReadFailure,
  isWorldSwitching,
  isCollaboratorTransitionActive,
  backgroundUrl,
  backgroundBlur,
  starStyle,
  appLayoutSurface,
  hasWideLayout,
  showDesktopSidebar,
  effectiveDesktopSidebarCollapsed,
  CollectionWorld,
  ChatWorld,
  GroupWorld,
  worldRetryKeys,
  retryWorldFrame,
  toggleDesktopSidebarCollapsed,
  collectionScopeDrawerOpen,
  collectionFrameInteractive,
  chatFrameInteractive,
  groupFrameInteractive
}: AppShellViewProps) {
  const worldStack = (
    <section className="world-stack">
      {worldPresence.renderCollection && (
        <div
          className={`world-frame collection-frame ${activeWorld === 'collection' ? 'active' : ''} ${collectionFrameInteractive ? 'interactive' : ''} ${worldPresence.hideCollection ? 'occluded' : ''} ${collectionDetailOpen ? 'detail-open' : ''}`}
        >
          <WorldFrameBoundary
            world="collection"
            retryKey={worldRetryKeys.collection}
            onRetry={() => retryWorldFrame('collection')}
          >
            <Suspense fallback={<WorldFrameFallback world="collection" />}>
              <CollectionWorld
                searchOpen={collectionSearchOpen}
                collaboratorSwitchOpen={collectionScopeDrawerOpen}
                onCollaboratorSwitchOpenChange={setCollectionCollaboratorSwitchOpen}
                onDeleteCollaborator={collectionDeleteCollaborator}
                onOpenSettings={collectionOpenSettings}
                infoFullscreenOpen={collectionInfoFullscreenOpen}
                onInfoFullscreenOpenChange={setCollectionInfoFullscreenOpen}
                onDetailOpenChange={setCollectionDetailOpen}
                onOpenCollaboratorBuilderForCreate={collectionOpenCollaboratorBuilderForCreate}
                onCreateCustomCollaborator={collectionCreateCustomCollaborator}
                onOpenProviderSettings={collectionOpenProviderSettings}
                onOpenDesktopLocalSettings={collectionOpenDesktopLocalSettings}
                onCollectionDrawerNavigate={collectionDrawerNavigate}
              />
            </Suspense>
          </WorldFrameBoundary>
        </div>
      )}
      {worldPresence.renderChat && (
        <div className={`world-frame chat-frame ${activeWorld === 'chat' ? 'active' : ''} ${chatFrameInteractive ? 'interactive' : ''} ${worldPresence.hideChat ? 'occluded' : ''}`}>
          <WorldFrameBoundary
            world="chat"
            retryKey={worldRetryKeys.chat}
            onRetry={() => retryWorldFrame('chat')}
          >
            <Suspense fallback={<WorldFrameFallback world="chat" />}>
              <ChatWorld {...chatWorldProps} />
            </Suspense>
          </WorldFrameBoundary>
        </div>
      )}
      {worldPresence.renderGroup && (
        <div className={`world-frame group-frame ${activeWorld === 'group' ? 'active' : ''} ${groupFrameInteractive ? 'interactive' : ''} ${worldPresence.hideGroup ? 'occluded' : ''}`}>
          <WorldFrameBoundary
            world="group"
            retryKey={worldRetryKeys.group}
            onRetry={() => retryWorldFrame('group')}
          >
            <Suspense fallback={<WorldFrameFallback world="group" />}>
              <GroupWorld {...groupWorldProps} />
            </Suspense>
          </WorldFrameBoundary>
        </div>
      )}
    </section>
  );

  // 启动时清掉"上次打开的工作区"：按系统返回是直接退出 App，
  // 如果把这个 id 持久化下来，下次打开又会落回工作区页（用户抱怨的就是这个）。
  useEffect(() => {
    const state = useSpaceStore.getState();
    if (state.collectionProjectId) state.setCollectionProjectId(null);
  }, []);

  const handleEdgeOpenDrawer = () => {
    if (!topbarProps.state.collaboratorSwitchOpen) {
      topbarProps.actions.onToggleCollaboratorSwitch();
    }
  };

  const handleEdgeBack = () => {
    if (overlaysProps.menu.open) {
      overlaysProps.menu.onClose();
      return true;
    }
    if (collectionInfoFullscreenOpen) {
      setCollectionInfoFullscreenOpen(false);
      return true;
    }
    if (collectionDetailOpen) {
      setCollectionDetailOpen(false);
      return true;
    }
    if (collectionScopeDrawerOpen) {
      setCollectionCollaboratorSwitchOpen(false);
      return true;
    }
    if (activeWorld !== 'chat') {
      onReturnToChat();
      return true;
    }
    return false;
  };

  return (
    <main
      className={`app-shell app-layout-${appLayoutSurface} ${hasWideLayout ? 'app-layout-wide' : 'app-layout-compact'} ${showDesktopSidebar ? 'has-desktop-sidebar' : ''} ${showDesktopSidebar && effectiveDesktopSidebarCollapsed ? 'desktop-sidebar-collapsed' : ''} ${activeWorld} world-chroma-${shellWorld} chat-render-${activeChatDensity} ${isWorldSwitching ? 'world-switching' : ''} ${isCollaboratorTransitionActive ? 'collaborator-transition-active' : ''} ${collectionScopeDrawerOpen ? 'collaborator-scope-drawer-active' : ''} ${themeTransitionPhase ? `theme-transition-${themeTransitionPhase}` : ''}`}
      style={starStyle}
    >
      {backgroundUrl ? (
        <div className="app-shell-background-override" aria-hidden="true">
          <div
            className="app-shell-background-image"
            style={{
              backgroundImage: `url("${backgroundUrl}")`,
              backgroundSize: customization.backgroundFit,
              opacity: customization.backgroundOpacity,
              filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined
            }}
          />
          <div
            className="app-shell-background-dim"
            style={{
              opacity: customization.backgroundDim
            }}
          />
        </div>
      ) : null}
      <div className="bg-glow bg-glow-top" />
      <div className="bg-glow bg-glow-bottom" />
      <div className="theme-transition-veil" aria-hidden="true" />
      <div className="collaborator-transition-veil" aria-hidden="true" />
      {!startupThemeReady ? (
        <div className="startup-theme-veil" aria-hidden="true">
          <ChaoticOrbitLoader size={38} />
        </div>
      ) : null}
      {showDesktopSidebar ? (
        <DesktopAppShellFrame
          desktopSidebarProps={{
            ...desktopSidebarProps,
            collapsed: effectiveDesktopSidebarCollapsed,
            onToggleCollapsed: toggleDesktopSidebarCollapsed
          }}
        >
          {worldStack}
        </DesktopAppShellFrame>
      ) : (
        <MobileAppShellFrame
          topbarProps={topbarProps}
          onEdgeOpenDrawer={handleEdgeOpenDrawer}
          onEdgeBack={handleEdgeBack}
        >
          {worldStack}
        </MobileAppShellFrame>
      )}

      <AppReplyNotificationStack {...replyNotificationProps} />
      <PersistenceReadFailureNotice
        notice={persistenceReadFailureNotice}
        onRetry={onRetryPersistenceReadFailure}
        onOpenBackup={onOpenBackupFromReadFailure}
      />
      <AppShellOverlays {...overlaysProps} />
    </main>
  );
}

