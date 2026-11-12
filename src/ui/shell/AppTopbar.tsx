import {
  getRunCodeSandboxProfile,
  lockRunCodeSandbox,
  unlockRunCodeSandbox
} from '../../infrastructure/runCodeSandboxMode';
import type { ActiveThemePreview } from '../../stores/spaceStore';
import type { CollectionShelf, World } from '../../types/domain';
import { Icon } from '../Icon';
import { runSelectionAction } from '../haptics';
import { requestCollectionCreate } from '../../app/shell/collectionCreateCommands';
import { WorldAnchor } from './WorldAnchor';
import { useI18n } from '../../i18n';

export type AppTopbarState = {
  activeWorld: World;
  title: string;
  titleTone: 'brand' | 'collaborator';
  isAggregateCollectionScope: boolean;
  worldLabel: string;
  worldDetail: string | null;
  showWorldLabel: boolean;
  showShell: boolean;
  showTitle: boolean;
  collaboratorSwitchOpen: boolean;
  collectionShelf: CollectionShelf;
  searchOpen: boolean;
  /** chat 世界：对话内搜索面板是否打开。 */
  chatSearchOpen: boolean;
  collectionInfoFullscreenOpen: boolean;
  menuOpen: boolean;
  activeThemePreview: ActiveThemePreview;
};

export type AppTopbarActions = {
  onToggleWorld: () => void;
  onToggleCollaboratorSwitch: () => void;
  onCreateConversation: () => void;
  onToggleSearch: () => void;
  onToggleChatSearch: () => void;
  onOpenCollectionInfoFullscreen: () => void;
  onToggleMenu: () => void;
  onOpenSettings: () => void;
  onOpenPreviewChat: () => void;
};

export type AppTopbarProps = {
  state: AppTopbarState;
  actions: AppTopbarActions;
};

export function AppTopbar({
  state,
  actions
}: AppTopbarProps) {
  const { t } = useI18n();
  const handleSelectionAction = (action: () => void, trigger: EventTarget | null) => {
    runSelectionAction(action, { element: trigger });
  };
  // 抽屉本身挂在 collection 世界里；「从 chat 打开时先切世界、关闭时原路退回」
  // 这段状态由 shell controller 统一管，这里只负责发一次点击。
  const handleCollaboratorGate = () => {
    actions.onToggleCollaboratorSwitch();
  };

  const handleSecretSandboxPrompt = () => {
    const currentProfile = getRunCodeSandboxProfile();
    const value = window.prompt(
      currentProfile === 'experimental'
        ? t('topbar.secretPromptExperimental')
        : t('topbar.secretPromptLocked'),
      ''
    );
    if (value === null) return;

    const trimmed = value.trim();
    if (!trimmed && currentProfile !== 'safe') {
      if (lockRunCodeSandbox()) {
        window.alert(t('topbar.sandboxLocked'));
      }
      return;
    }

    const nextProfile = unlockRunCodeSandbox(trimmed);
    if (nextProfile === 'experimental') {
      window.alert(t('topbar.sandboxUnlocked'));
      return;
    }

    window.alert(t('topbar.secretWrong'));
  };
  const collectionCardsEditable = state.activeWorld === 'collection'
    && (state.collectionShelf === 'code' || state.collectionShelf === 'dialogue');
  const canOpenCollectionSearch = state.activeWorld === 'collection' && state.collectionShelf !== 'info' && state.collectionShelf !== 'image';
  const collectionCreateShelf = state.activeWorld === 'collection' && !state.isAggregateCollectionScope && (state.collectionShelf === 'project' || state.collectionShelf === 'code' || state.collectionShelf === 'dialogue') ? state.collectionShelf : null;
  const canOpenCollectionInfoSettings = state.activeWorld === 'collection' && state.collectionShelf === 'info';
  const collectionSearchTitle = collectionCardsEditable ? t('common.editOrSearch') : t('common.search');
  const collectionSearchLabel = collectionSearchTitle;
  const collectionSearchIcon = collectionCardsEditable ? 'editList' : 'search';
  const showCollaboratorGate = state.activeWorld !== 'group';

  if (!state.showShell) {
    return null;
  }

  return (
    <header className="topbar chat-topbar-shell topbar--mirrored topbar--centered-context">
      <div className="topbar-surface">
        <div className="topbar-main">
          <WorldAnchor
            onToggleWorld={() => actions.onToggleWorld()}
            onSecretLongPress={handleSecretSandboxPrompt}
            switchLabel={t('topbar.goHome')}
          />

          <div className="topbar-actions topbar-actions--leading">
            {showCollaboratorGate ? (
              <button
                type="button"
                className={`action-btn icon-btn collaborator-gate-btn ${state.collaboratorSwitchOpen ? 'active' : ''}`}
                title={t('topbar.switchCollaboratorSpace')}
                aria-label={t('topbar.switchCollaboratorSpace')}
                aria-expanded={state.collaboratorSwitchOpen}
                onClick={(event) => handleSelectionAction(handleCollaboratorGate, event.currentTarget)}
              >
                <Icon name="drawerGate" size={19} />
              </button>
            ) : null}
          </div>

          <div className="topbar-actions">
            {canOpenCollectionInfoSettings && (
              <button
                type="button"
                className={`action-btn icon-btn topbar-settings-btn ${state.menuOpen ? 'active' : ''}`}
                title={t('common.settings')}
                aria-label={t('common.settings')}
                onClick={(event) => handleSelectionAction(actions.onOpenSettings, event.currentTarget)}
              >
                <Icon name="settings" size={18} />
              </button>
            )}

            {state.activeWorld === 'chat' && (
              <button
                type="button"
                className={`action-btn icon-btn ${state.chatSearchOpen ? 'active' : ''}`}
                onClick={(event) => handleSelectionAction(actions.onToggleChatSearch, event.currentTarget)}
                title={t('chat.search.entry')}
                aria-label={t('chat.search.entry')}
                aria-expanded={state.chatSearchOpen}
              >
                <Icon name="search" size={19} />
              </button>
            )}

            {state.activeWorld === 'chat' && (
              <button
                type="button"
                className="action-btn icon-btn topbar-new-chat-btn"
                onClick={(event) => handleSelectionAction(actions.onCreateConversation, event.currentTarget)}
                title={t('common.newConversation')}
                aria-label={t('common.newConversation')}
              >
                <Icon name="plus" size={18} />
              </button>
            )}

            {collectionCreateShelf ? (
              <button
                type="button"
                className="action-btn icon-btn topbar-new-chat-btn topbar-project-create-btn"
                onClick={(event) => handleSelectionAction(() => requestCollectionCreate(collectionCreateShelf), event.currentTarget)}
                title={
                  collectionCreateShelf === 'project'
                    ? t('collection.project.createWorkspace')
                    : collectionCreateShelf === 'code'
                      ? t('collection.code.createOrImport')
                        : t('collection.world.newConversation')
                }
                aria-label={
                  collectionCreateShelf === 'project'
                    ? t('collection.project.createWorkspace')
                    : collectionCreateShelf === 'code'
                      ? t('collection.code.createOrImport')
                        : t('collection.world.newConversation')
                }
              >
                <Icon name="plus" size={18} />
              </button>
            ) : null}
            {canOpenCollectionSearch && (
              <button type="button" className={`action-btn icon-btn ${state.searchOpen ? 'active' : ''}`} title={collectionSearchTitle} aria-label={collectionSearchLabel} onClick={(event) => handleSelectionAction(actions.onToggleSearch, event.currentTarget)}>
                <Icon name={collectionSearchIcon} size={19} />
              </button>
            )}
          </div>
        </div>
      </div>

      {state.activeThemePreview && (
        <button type="button" className="preview-banner-trigger" onClick={(event) => handleSelectionAction(actions.onOpenPreviewChat, event.currentTarget)}>
          <span className="preview-banner-dot" />
          <span>{t('topbar.previewActive')}</span>
        </button>
      )}
    </header>
  );
}
